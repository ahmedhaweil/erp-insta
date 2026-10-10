import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '@modules/inventory/entities/product.entity';
import { RbacService } from '@modules/auth/services/rbac.service';
import {
  Names,
  SalesAnalysisService,
  SalesFact,
} from '@modules/reports/services/sales-analysis.service';
import { BRANCH_JOINS, SqlParams, ledgerWhere } from '@modules/reports/services/ledger-sql';
import { today as todayIso } from '@shared/utils/document-totals.util';
import { AnalyticsQueryDto } from '../dto/analytics.dto';
import {
  AnalyticsSettingsService,
  AnalyticsSettingsValues,
  thresholdsOf,
} from './analytics-settings.service';
import {
  Insight,
  ItemPerformance,
  Period,
  buildInsights,
  changePct,
  classifyItems,
  dailyRate,
  daysBetween,
  daysCover,
  isOverstock,
  isSlowMoving,
  lowStockStatus,
  marginPct,
  r2,
  r4,
  resolvePeriod,
  sharePct,
  stripProfit,
  suggestedPurchaseQty,
} from './analytics-calculator';

export const PROFIT_PERMISSION = { module: 'analytics', screen: 'profit', action: 'read' };

interface Scope {
  tenantId: string;
  period: Period;
  today: string;
  branchId?: string;
  warehouseId?: string;
  /** Warehouses in scope (null = all). */
  warehouseIds: string[] | null;
  stagnationDays: number;
  lowCoverDays: number;
  overstockDays: number;
  coverDays: number;
  limit: number;
  settings: AnalyticsSettingsValues;
}

interface StockRow {
  productId: string;
  code: string;
  name: string;
  categoryId: string | null;
  unitCost: number;
  reorderLevel: number;
  preferredSupplierId: string | null;
  onHand: number;
  hasStock: boolean;
}

interface ProductSales {
  quantity: number;
  sales: number;
  cost: number;
}

interface DocSummary {
  source: SalesFact['source'];
  docId: string;
  date: string;
  partnerId: string | null;
  userId: string | null;
  net: number;
  cost: number;
  discount: number;
}

/** Totals of a set of sales facts, returns separated by document. */
export interface PeriodTotals {
  sales: number;
  returns: number;
  netSales: number;
  cost: number;
  grossProfit: number;
  margin: number;
  qtySold: number;
  distinctItems: number;
  invoiceCount: number;
  averageInvoice: number;
}

/** Groups facts into documents; a document whose net is negative is a return (credit note / POS refund). */
export function summarizeDocs(facts: SalesFact[]): DocSummary[] {
  const docs = new Map<string, DocSummary>();
  for (const f of facts) {
    const key = `${f.source}:${f.docId}`;
    const d =
      docs.get(key) ??
      ({ source: f.source, docId: f.docId, date: f.date, partnerId: f.partnerId, userId: f.userId, net: 0, cost: 0, discount: 0 } as DocSummary);
    d.net = r4(d.net + f.net);
    d.cost = r4(d.cost + f.cost);
    d.discount = r4(d.discount + (f.discount ?? 0));
    docs.set(key, d);
  }
  return [...docs.values()];
}

export function periodTotals(facts: SalesFact[]): PeriodTotals {
  const docs = summarizeDocs(facts);
  const salesDocs = docs.filter((d) => d.net > 0);
  const sales = r4(salesDocs.reduce((s, d) => s + d.net, 0));
  const returns = r4(-docs.filter((d) => d.net < 0).reduce((s, d) => s + d.net, 0));
  const netSales = r4(sales - returns);
  const cost = r4(facts.reduce((s, f) => s + f.cost, 0));
  const grossProfit = r4(netSales - cost);
  const qty = new Map<string, number>();
  for (const f of facts) qty.set(f.productId, (qty.get(f.productId) ?? 0) + f.quantity);
  return {
    sales,
    returns,
    netSales,
    cost,
    grossProfit,
    margin: marginPct(netSales, grossProfit),
    qtySold: r4(facts.reduce((s, f) => s + f.quantity, 0)),
    distinctItems: [...qty.values()].filter((q) => q > 0).length,
    invoiceCount: salesDocs.length,
    averageInvoice: salesDocs.length ? r4(sales / salesDocs.length) : 0,
  };
}

function byProduct(facts: SalesFact[]): Map<string, ProductSales> {
  const m = new Map<string, ProductSales>();
  for (const f of facts) {
    const p = m.get(f.productId) ?? { quantity: 0, sales: 0, cost: 0 };
    p.quantity = r4(p.quantity + f.quantity);
    p.sales = r4(p.sales + f.net);
    p.cost = r4(p.cost + f.cost);
    m.set(f.productId, p);
  }
  return m;
}

/**
 * Lazily loaded data of one analytics request. Loads run sequentially: the
 * request uses a single transactional connection.
 */
class AnalyticsContext {
  private cache = new Map<string, unknown>();

  constructor(
    readonly scope: Scope,
    private readonly svc: AnalyticsService,
  ) {}

  async memo<T>(key: string, load: () => Promise<T>): Promise<T> {
    if (!this.cache.has(key)) this.cache.set(key, await load());
    return this.cache.get(key) as T;
  }

  facts = () => this.memo('facts', () => this.svc.loadFacts(this.scope, this.scope.period.from, this.scope.period.to));
  prevFacts = () =>
    this.memo('prevFacts', () => this.svc.loadFacts(this.scope, this.scope.period.prevFrom, this.scope.period.prevTo));
  names = () => this.memo('names', () => this.svc.sales.names(this.scope.tenantId));
  stock = () => this.memo('stock', () => this.svc.loadStock(this.scope));
  lastSales = () => this.memo('lastSales', () => this.svc.loadLastSales(this.scope));
  incoming = () => this.memo('incoming', () => this.svc.loadIncoming(this.scope));
}

/**
 * Business analytics and insights (Instasoft module/analytics.vb): KPIs with
 * comparison period, stock health, item / category / customer performance,
 * purchase suggestions and rule-based insight cards. Sales facts come from
 * the reports module (posted invoices net of credit notes + POS orders net of
 * refunds, cost from stock moves).
 */
@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    readonly sales: SalesAnalysisService,
    private readonly settings: AnalyticsSettingsService,
    @Optional() private readonly rbac?: RbacService,
  ) {}

  private query<T = any>(sql: string, params: unknown[]): Promise<T[]> {
    return this.productRepo.query(sql, params);
  }

  async canSeeProfit(tenantId: string, userId: string): Promise<boolean> {
    if (!this.rbac) return true;
    return this.rbac.hasPermission(tenantId, userId, PROFIT_PERMISSION);
  }

  /** Strips profit, cost, margin and stock value fields for users without analytics/profit/read. */
  async visible<T>(tenantId: string, userId: string, data: T): Promise<T> {
    return (await this.canSeeProfit(tenantId, userId)) ? data : stripProfit(data);
  }

  async context(tenantId: string, q: AnalyticsQueryDto): Promise<AnalyticsContext> {
    const today = todayIso();
    let period: Period;
    try {
      period = resolvePeriod(q.from, q.to, today);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const settings = await this.settings.get(tenantId);
    let warehouseIds: string[] | null = null;
    if (q.warehouseId) warehouseIds = [q.warehouseId];
    else if (q.branchId) {
      const rows = await this.query<{ id: string }>(
        `SELECT id FROM warehouses WHERE tenant_id = $1 AND branch_id = $2`,
        [tenantId, q.branchId],
      );
      warehouseIds = rows.map((r) => r.id);
    }
    return new AnalyticsContext(
      {
        tenantId,
        period,
        today,
        branchId: q.branchId,
        warehouseId: q.warehouseId,
        warehouseIds,
        stagnationDays: q.stagnationDays ?? settings.stagnationDays,
        lowCoverDays: q.lowCoverDays ?? settings.lowCoverDays,
        overstockDays: q.overstockDays ?? settings.overstockDays,
        coverDays: q.coverDays ?? settings.purchaseCoverDays,
        limit: q.limit ?? 20,
        settings,
      },
      this,
    );
  }

  // ─────────────────────────── loaders ───────────────────────────

  loadFacts(s: Scope, from: string, to: string): Promise<SalesFact[]> {
    return this.sales.salesFacts(s.tenantId, { from, to, branchId: s.branchId, warehouseId: s.warehouseId });
  }

  /** Active goods with on-hand quantity in the warehouses in scope. */
  async loadStock(s: Scope): Promise<StockRow[]> {
    const p = new SqlParams();
    const tenant = p.add(s.tenantId);
    const whFilter = s.warehouseIds ? ` AND st.warehouse_id = ANY(${p.add(s.warehouseIds)}::uuid[])` : '';
    const rows = await this.query(
      `SELECT pr.id, pr.code, pr.name_ar, pr.name_en, pr.category_id, pr.cost_price, pr.reorder_level,
              pr.preferred_supplier_id, COALESCE(SUM(st.quantity), 0) AS on_hand, COUNT(st.id) AS stock_rows
         FROM products pr
         LEFT JOIN stocks st ON st.product_id = pr.id AND st.tenant_id = pr.tenant_id${whFilter}
        WHERE pr.tenant_id = ${tenant} AND pr.is_active = true AND pr.type = 'goods'
        GROUP BY pr.id`,
      p.values,
    );
    return rows.map((r) => ({
      productId: r.id,
      code: r.code,
      name: r.name_en || r.name_ar,
      categoryId: r.category_id ?? null,
      unitCost: Number(r.cost_price) || 0,
      reorderLevel: Number(r.reorder_level) || 0,
      preferredSupplierId: r.preferred_supplier_id ?? null,
      onHand: r4(Number(r.on_hand) || 0),
      hasStock: Number(r.stock_rows) > 0,
    }));
  }

  /** Last sale date per product (all time, sales documents only, same branch/warehouse scope). */
  async loadLastSales(s: Scope): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const keep = (rows: { productId: string; last: string }[]) => {
      for (const r of rows) {
        const d = String(r.last).slice(0, 10);
        const cur = out.get(r.productId);
        if (!cur || d > cur) out.set(r.productId, d);
      }
    };
    {
      const p = new SqlParams();
      const where = [
        `i.tenant_id = ${p.add(s.tenantId)}`,
        `i.status NOT IN ('draft', 'cancelled')`,
        `i.move_type <> 'credit_note'`,
      ];
      if (s.branchId) where.push(`i.branch_id = ${p.add(s.branchId)}`);
      if (s.warehouseId) {
        where.push(
          `EXISTS (SELECT 1 FROM sales_orders wso WHERE wso.id = i.order_id AND wso.warehouse_id = ${p.add(s.warehouseId)})`,
        );
      }
      keep(
        await this.query(
          `SELECT l.product_id AS "productId", to_char(MAX(i.date), 'YYYY-MM-DD') AS last
             FROM sales_invoice_lines l JOIN sales_invoices i ON i.id = l.invoice_id
            WHERE ${where.join(' AND ')} GROUP BY l.product_id`,
          p.values,
        ),
      );
    }
    {
      const p = new SqlParams();
      const where = [
        `o.tenant_id = ${p.add(s.tenantId)}`,
        `o.status IN ('completed', 'refunded')`,
        `o.refunded_order_id IS NULL`,
      ];
      if (s.branchId) where.push(`t.branch_id = ${p.add(s.branchId)}`);
      if (s.warehouseId) where.push(`t.warehouse_id = ${p.add(s.warehouseId)}`);
      keep(
        await this.query(
          `SELECT l.product_id AS "productId", to_char(MAX(o.created_at), 'YYYY-MM-DD') AS last
             FROM pos_order_lines l JOIN pos_orders o ON o.id = l.order_id
             LEFT JOIN pos_sessions ps ON ps.id = o.session_id
             LEFT JOIN pos_terminals t ON t.id = ps.terminal_id
            WHERE ${where.join(' AND ')} GROUP BY l.product_id`,
          p.values,
        ),
      );
    }
    return out;
  }

  /** Open quantity of open purchase orders per product. */
  async loadIncoming(s: Scope): Promise<Map<string, number>> {
    const p = new SqlParams();
    const where = [
      `o.tenant_id = ${p.add(s.tenantId)}`,
      `o.status IN ('draft', 'sent', 'to_approve', 'confirmed')`,
    ];
    if (s.warehouseId) where.push(`o.warehouse_id = ${p.add(s.warehouseId)}`);
    else if (s.branchId) {
      where.push(
        `(o.branch_id = ${p.add(s.branchId)} OR o.warehouse_id = ANY(${p.add(s.warehouseIds ?? [])}::uuid[]))`,
      );
    }
    const rows = await this.query(
      `SELECT l.product_id AS "productId", SUM(GREATEST(l.quantity - COALESCE(l.qty_received, 0), 0)) AS qty
         FROM purchase_order_lines l JOIN purchase_orders o ON o.id = l.order_id
        WHERE ${where.join(' AND ')} GROUP BY l.product_id`,
      p.values,
    );
    return new Map(rows.map((r) => [r.productId, r4(Number(r.qty) || 0)]));
  }

  /**
   * Operating expenses from the GL: posted lines on expense accounts, minus
   * the cost-of-sales style defaults (COGS, purchases, purchase returns,
   * sales returns and discounts), closing entries excluded.
   */
  async expenses(tenantId: string, from: string, to: string, branchId?: string): Promise<number> {
    const [settings] = await this.query(
      `SELECT cogs_account_id, purchase_account_id, purchase_return_account_id,
              sales_return_account_id, sales_discount_account_id
         FROM accounting_settings WHERE tenant_id = $1 LIMIT 1`,
      [tenantId],
    );
    const excluded = Object.values(settings ?? {}).filter(Boolean) as string[];
    const p = new SqlParams();
    const where = ledgerWhere(p, { tenantId, from, to, branchId, excludeClosing: true });
    const [row] = await this.query(
      `SELECT COALESCE(SUM(l.debit - l.credit), 0) AS amount
         FROM journal_lines l
         JOIN journal_entries e ON e.id = l.entry_id
         JOIN accounts a ON a.id = l.account_id
         ${branchId ? BRANCH_JOINS : ''}
        WHERE ${where} AND a.type = 'expense'
          AND NOT (a.id = ANY(${p.add(excluded)}::uuid[]))`,
      p.values,
    );
    return r4(Number(row?.amount) || 0);
  }

  async purchases(tenantId: string, from: string, to: string, branchId?: string): Promise<number> {
    const res = await this.sales.purchaseAnalysis(tenantId, { from, to, branchId, groupBy: 'month' });
    return r4(Number(res.totals.net) || 0);
  }

  /** Balances (base currency) of active cash boxes and bank accounts. */
  async treasuryBalances(tenantId: string, branchId?: string) {
    const params: unknown[] = [tenantId];
    let branch = '';
    if (branchId) {
      params.push(branchId);
      branch = ` AND t.branch_id = $2`;
    }
    const rows = await this.query(
      `SELECT t.id, t.code, t.name_ar, t.name_en, t.type,
              COALESCE(SUM(CASE WHEN e.id IS NULL THEN 0 ELSE l.debit - l.credit END), 0) AS balance
         FROM treasuries t
         LEFT JOIN journal_lines l ON l.account_id = t.account_id
         LEFT JOIN journal_entries e ON e.id = l.entry_id AND e.status = 'posted'
        WHERE t.tenant_id = $1 AND t.is_active = true${branch}
        GROUP BY t.id`,
      params,
    );
    return rows.map((r) => ({
      treasuryId: r.id as string,
      code: r.code as string,
      name: (r.name_en || r.name_ar) as string,
      nameAr: r.name_ar as string,
      type: r.type as string,
      balance: r4(Number(r.balance) || 0),
    }));
  }

  /** POS cash differences of sessions closed in the period, per user. */
  async posCashDifferences(s: Scope) {
    const p = new SqlParams();
    const where = [
      `ps.tenant_id = ${p.add(s.tenantId)}`,
      `ps.closed_at IS NOT NULL`,
      `ps.cash_difference IS NOT NULL`,
      `ps.closed_at::date >= ${p.add(s.period.from)}`,
      `ps.closed_at::date <= ${p.add(s.period.to)}`,
    ];
    if (s.branchId) where.push(`t.branch_id = ${p.add(s.branchId)}`);
    if (s.warehouseId) where.push(`t.warehouse_id = ${p.add(s.warehouseId)}`);
    const rows = await this.query(
      `SELECT ps.user_id AS "userId", u.name AS "userName", COUNT(*) AS sessions,
              SUM(ps.cash_difference) AS difference, SUM(ABS(ps.cash_difference)) AS "absDifference"
         FROM pos_sessions ps
         LEFT JOIN pos_terminals t ON t.id = ps.terminal_id
         LEFT JOIN users u ON u.id = ps.user_id
        WHERE ${where.join(' AND ')}
        GROUP BY ps.user_id, u.name`,
      p.values,
    );
    return rows
      .map((r) => ({
        userId: r.userId as string,
        userName: (r.userName ?? '') as string,
        sessions: Number(r.sessions),
        difference: r4(Number(r.difference) || 0),
        absDifference: r4(Number(r.absDifference) || 0),
      }))
      .sort((a, b) => b.absDifference - a.absDifference);
  }

  // ─────────────────────────── computations ───────────────────────────

  async kpi(ctx: AnalyticsContext) {
    const s = ctx.scope;
    const cur = periodTotals(await ctx.facts());
    const prev = periodTotals(await ctx.prevFacts());
    const purchases = await this.purchases(s.tenantId, s.period.from, s.period.to, s.branchId);
    const prevPurchases = await this.purchases(s.tenantId, s.period.prevFrom, s.period.prevTo, s.branchId);
    const expenses = await this.expenses(s.tenantId, s.period.from, s.period.to, s.branchId);
    const prevExpenses = await this.expenses(s.tenantId, s.period.prevFrom, s.period.prevTo, s.branchId);
    const stock = await ctx.stock();
    const universe = await this.stockUniverse(ctx);
    const stockValue = r4(stock.reduce((sum, r) => sum + Math.max(r.onHand, 0) * r.unitCost, 0));
    const outOfStockCount = universe.filter((r) => r.onHand <= 0).length;
    const slow = await this.slowMoving(ctx);
    const low = await this.lowStock(ctx);
    const over = await this.overstock(ctx);

    const metric = (key: keyof PeriodTotals) => ({
      [key]: cur[key],
      [`prev${key[0].toUpperCase()}${key.slice(1)}`]: prev[key],
      [`${key}ChangePct`]: changePct(cur[key], prev[key]),
    });
    return {
      period: s.period,
      branchId: s.branchId ?? null,
      warehouseId: s.warehouseId ?? null,
      ...metric('sales'),
      ...metric('returns'),
      ...metric('netSales'),
      ...metric('cost'),
      ...metric('grossProfit'),
      margin: cur.margin,
      prevMargin: prev.margin,
      marginChange: r2(cur.margin - prev.margin),
      ...metric('qtySold'),
      ...metric('distinctItems'),
      ...metric('invoiceCount'),
      ...metric('averageInvoice'),
      purchases,
      prevPurchases,
      purchasesChangePct: changePct(purchases, prevPurchases),
      expenses,
      prevExpenses,
      expensesChangePct: changePct(expenses, prevExpenses),
      stockValue,
      outOfStockCount,
      lowStockCount: low.rows.filter((r) => r.status !== 'out_of_stock').length,
      slowMovingCount: slow.rows.length,
      overstockCount: over.rows.length,
    };
  }

  /** Products that matter for stock alerts: stocked in scope, with a reorder level, or sold in the period. */
  private async stockUniverse(ctx: AnalyticsContext): Promise<StockRow[]> {
    const sold = byProduct(await ctx.facts());
    return (await ctx.stock()).filter((r) => r.hasStock || r.reorderLevel > 0 || (sold.get(r.productId)?.quantity ?? 0) !== 0);
  }

  private async categoryName(ctx: AnalyticsContext, id: string | null): Promise<string> {
    const names = await ctx.names();
    return id ? names.categories.get(id) ?? id : 'Uncategorised';
  }

  async slowMoving(ctx: AnalyticsContext) {
    const s = ctx.scope;
    return ctx.memo('slowMoving', async () => {
      const sold = byProduct(await ctx.facts());
      const last = await ctx.lastSales();
      const rows = [];
      for (const r of await ctx.stock()) {
        const lastSaleDate = last.get(r.productId) ?? null;
        const days = lastSaleDate ? daysBetween(lastSaleDate, s.today) : null;
        if (!isSlowMoving(r.onHand, days, s.stagnationDays)) continue;
        rows.push({
          productId: r.productId,
          code: r.code,
          name: r.name,
          categoryName: await this.categoryName(ctx, r.categoryId),
          onHand: r.onHand,
          unitCost: r.unitCost,
          stockValue: r4(r.onHand * r.unitCost),
          lastSaleDate,
          daysSinceLastSale: days,
          qtySoldInPeriod: sold.get(r.productId)?.quantity ?? 0,
          threshold: s.stagnationDays,
        });
      }
      rows.sort((a, b) => b.stockValue - a.stockValue);
      return {
        period: s.period,
        stagnationDays: s.stagnationDays,
        rows,
        slowValue: r4(rows.reduce((sum, r) => sum + r.stockValue, 0)),
      };
    });
  }

  async lowStock(ctx: AnalyticsContext) {
    const s = ctx.scope;
    return ctx.memo('lowStock', async () => {
      const sold = byProduct(await ctx.facts());
      const incoming = await ctx.incoming();
      const rows = [];
      for (const r of await this.stockUniverse(ctx)) {
        const qty = Math.max(sold.get(r.productId)?.quantity ?? 0, 0);
        const rate = dailyRate(qty, s.period.days);
        const cover = daysCover(r.onHand, rate);
        const status = lowStockStatus(r.onHand, r.reorderLevel, cover, s.lowCoverDays);
        if (!status) continue;
        rows.push({
          productId: r.productId,
          code: r.code,
          name: r.name,
          categoryName: await this.categoryName(ctx, r.categoryId),
          onHand: r.onHand,
          reorderLevel: r.reorderLevel,
          incoming: incoming.get(r.productId) ?? 0,
          qtySold: qty,
          dailyRate: r4(rate),
          daysCover: cover,
          status,
        });
      }
      rows.sort(
        (a, b) =>
          Number(b.status === 'out_of_stock') - Number(a.status === 'out_of_stock') ||
          (a.daysCover ?? Infinity) - (b.daysCover ?? Infinity),
      );
      return { period: s.period, lowCoverDays: s.lowCoverDays, rows };
    });
  }

  /**
   * Overstock: in stock, sold in the period, and covering ≥ overstockDays.
   * Products carry no maximum level in this ERP, so there is no above-maximum list.
   */
  async overstock(ctx: AnalyticsContext) {
    const s = ctx.scope;
    return ctx.memo('overstock', async () => {
      const sold = byProduct(await ctx.facts());
      const rows = [];
      for (const r of await ctx.stock()) {
        const qty = sold.get(r.productId)?.quantity ?? 0;
        const rate = dailyRate(qty, s.period.days);
        const cover = daysCover(r.onHand, rate);
        if (!isOverstock(r.onHand, qty, cover, s.overstockDays)) continue;
        rows.push({
          productId: r.productId,
          code: r.code,
          name: r.name,
          categoryName: await this.categoryName(ctx, r.categoryId),
          onHand: r.onHand,
          stockValue: r4(r.onHand * r.unitCost),
          qtySold: qty,
          dailyRate: r4(rate),
          daysCover: cover,
        });
      }
      rows.sort((a, b) => b.stockValue - a.stockValue);
      return { period: s.period, overstockDays: s.overstockDays, rows };
    });
  }

  async itemPerformance(ctx: AnalyticsContext): Promise<ItemPerformance[]> {
    return ctx.memo('items', async () => {
      const cur = byProduct(await ctx.facts());
      const prev = byProduct(await ctx.prevFacts());
      const names = await ctx.names();
      const items: ItemPerformance[] = [];
      for (const key of new Set([...cur.keys(), ...prev.keys()])) {
        const c = cur.get(key) ?? { quantity: 0, sales: 0, cost: 0 };
        const p = prev.get(key) ?? { quantity: 0, sales: 0, cost: 0 };
        const product = names.products.get(key);
        const profit = r4(c.sales - c.cost);
        const prevProfit = r4(p.sales - p.cost);
        const categoryId = product?.categoryId ?? null;
        items.push({
          key,
          code: product?.code ?? null,
          name: product?.name ?? key,
          categoryId,
          categoryName: categoryId ? names.categories.get(categoryId) ?? categoryId : 'Uncategorised',
          quantity: c.quantity,
          sales: c.sales,
          cost: c.cost,
          profit,
          margin: marginPct(c.sales, profit),
          prevQuantity: p.quantity,
          prevSales: p.sales,
          prevProfit,
          salesChangePct: c.sales === 0 && p.sales > 0 ? -100 : changePct(c.sales, p.sales),
          profitChange: r4(profit - prevProfit),
        });
      }
      return items.sort((a, b) => b.sales - a.sales);
    });
  }

  async items(ctx: AnalyticsContext) {
    const items = await this.itemPerformance(ctx);
    const q = classifyItems(items, ctx.scope.limit);
    return { period: ctx.scope.period, rows: items, ...q };
  }

  async categories(ctx: AnalyticsContext) {
    const items = await this.itemPerformance(ctx);
    const groups = new Map<string, any>();
    for (const i of items) {
      const key = i.categoryId ?? '';
      const g =
        groups.get(key) ??
        { categoryId: i.categoryId, name: i.categoryName, items: 0, quantity: 0, sales: 0, cost: 0, prevSales: 0, prevProfit: 0 };
      if (i.sales !== 0 || i.quantity !== 0) g.items += 1;
      g.quantity = r4(g.quantity + i.quantity);
      g.sales = r4(g.sales + i.sales);
      g.cost = r4(g.cost + i.cost);
      g.prevSales = r4(g.prevSales + i.prevSales);
      g.prevProfit = r4(g.prevProfit + i.prevProfit);
      groups.set(key, g);
    }
    const rows = [...groups.values()]
      .map((g) => {
        const profit = r4(g.sales - g.cost);
        return {
          ...g,
          profit,
          margin: marginPct(g.sales, profit),
          salesChangePct: changePct(g.sales, g.prevSales),
          profitChange: r4(profit - g.prevProfit),
          share: 0,
        };
      })
      .sort((a, b) => b.sales - a.sales);
    const total = rows.reduce((s, r) => s + Math.max(r.sales, 0), 0);
    for (const r of rows) r.share = sharePct(r.sales, total);
    return { period: ctx.scope.period, rows };
  }

  async purchaseSuggestions(ctx: AnalyticsContext) {
    const s = ctx.scope;
    return ctx.memo('suggestions', async () => {
      const sold = byProduct(await ctx.facts());
      const incoming = await ctx.incoming();
      const rows = [];
      for (const r of await ctx.stock()) {
        const qty = sold.get(r.productId)?.quantity ?? 0;
        if (qty <= 0) continue;
        const rate = dailyRate(qty, s.period.days);
        const inc = incoming.get(r.productId) ?? 0;
        const suggestedQty = suggestedPurchaseQty(rate, s.coverDays, r.onHand, inc);
        if (suggestedQty <= 0) continue;
        rows.push({
          productId: r.productId,
          code: r.code,
          name: r.name,
          categoryName: await this.categoryName(ctx, r.categoryId),
          preferredSupplierId: r.preferredSupplierId,
          onHand: r.onHand,
          incoming: inc,
          reorderLevel: r.reorderLevel,
          qtySold: qty,
          dailyRate: r4(rate),
          daysCover: daysCover(r.onHand, rate),
          suggestedQty,
          unitCost: r.unitCost,
          expectedCost: r4(suggestedQty * r.unitCost),
        });
      }
      rows.sort((a, b) => b.expectedCost - a.expectedCost || b.suggestedQty - a.suggestedQty);
      return {
        period: s.period,
        coverDays: s.coverDays,
        rows,
        expectedCost: r4(rows.reduce((sum, r) => sum + r.expectedCost, 0)),
      };
    });
  }

  async customers(ctx: AnalyticsContext) {
    const s = ctx.scope;
    return ctx.memo('customers', async () => {
      const names = await ctx.names();
      const curDocs = summarizeDocs(await ctx.facts()).filter((d) => d.partnerId);
      const prevDocs = summarizeDocs(await ctx.prevFacts()).filter((d) => d.partnerId);
      const label = (id: string) => names.partners.get(id) ?? { code: null, name: id };

      const agg = (docs: DocSummary[]) => {
        const m = new Map<string, { count: number; sales: number; cost: number; last: string | null }>();
        for (const d of docs) {
          const a = m.get(d.partnerId!) ?? { count: 0, sales: 0, cost: 0, last: null };
          if (d.net > 0) {
            a.count += 1;
            if (!a.last || d.date > a.last) a.last = d.date;
          }
          a.sales = r4(a.sales + d.net);
          a.cost = r4(a.cost + d.cost);
          m.set(d.partnerId!, a);
        }
        return m;
      };
      const cur = agg(curDocs);
      const prev = agg(prevDocs);

      const top = [...cur.entries()]
        .map(([id, a]) => {
          const prevSales = prev.get(id)?.sales ?? 0;
          const profit = r4(a.sales - a.cost);
          return {
            customerId: id,
            ...label(id),
            invoiceCount: a.count,
            sales: a.sales,
            profit,
            margin: marginPct(a.sales, profit),
            lastPurchaseDate: a.last,
            daysSinceLastPurchase: a.last ? daysBetween(a.last, s.today) : null,
            prevSales,
            salesChangePct: changePct(a.sales, prevSales),
          };
        })
        .sort((a, b) => b.sales - a.sales);

      const lost = [...prev.entries()]
        .filter(([id, a]) => a.sales > 0 && !cur.has(id))
        .map(([id, a]) => ({
          customerId: id,
          ...label(id),
          prevSales: a.sales,
          lastPurchaseDate: a.last,
          daysSinceLastPurchase: a.last ? daysBetween(a.last, s.today) : null,
        }))
        .sort((a, b) => b.prevSales - a.prevSales);

      // Active customers with no sale at all in the period
      const active = await this.query(
        `SELECT id, code, name_ar, name_en, balance FROM customers WHERE tenant_id = $1 AND is_active = true`,
        [s.tenantId],
      );
      const lastEver = await this.customerLastPurchase(s.tenantId, s.period.to);
      const stagnantAll = active
        .filter((c) => !cur.has(c.id))
        .map((c) => {
          const last = lastEver.get(c.id) ?? null;
          return {
            customerId: c.id as string,
            code: c.code as string,
            name: (c.name_en || c.name_ar) as string,
            balance: r4(Number(c.balance) || 0),
            lastPurchaseDate: last,
            daysSinceLastPurchase: last ? daysBetween(last, s.today) : null,
          };
        })
        .sort(
          (a, b) =>
            Number(a.lastPurchaseDate === null) - Number(b.lastPurchaseDate === null) ||
            (b.lastPurchaseDate ?? '').localeCompare(a.lastPurchaseDate ?? ''),
        );

      const totalNet = periodTotals(await ctx.facts()).netSales;
      const topSales = top[0]?.sales ?? 0;
      return {
        period: s.period,
        top: top.slice(0, s.limit),
        lost,
        stagnant: stagnantAll.slice(0, s.limit),
        stagnantCount: stagnantAll.length,
        concentration: {
          customers: top.length,
          topCustomer: top[0] ? { customerId: top[0].customerId, name: top[0].name, sales: topSales } : null,
          topCustomerSharePct: sharePct(topSales, totalNet),
          top5SharePct: sharePct(
            top.slice(0, 5).reduce((sum, c) => sum + c.sales, 0),
            totalNet,
          ),
        },
        totalCustomersRows: top.length,
      };
    });
  }

  private async customerLastPurchase(tenantId: string, upTo: string): Promise<Map<string, string>> {
    const rows = await this.query(
      `SELECT customer_id AS id, to_char(MAX(date), 'YYYY-MM-DD') AS last FROM sales_invoices
        WHERE tenant_id = $1 AND status NOT IN ('draft', 'cancelled') AND move_type <> 'credit_note'
          AND customer_id IS NOT NULL AND date <= $2
        GROUP BY customer_id
       UNION ALL
       SELECT customer_id AS id, to_char(MAX(created_at), 'YYYY-MM-DD') AS last FROM pos_orders
        WHERE tenant_id = $1 AND status IN ('completed', 'refunded') AND refunded_order_id IS NULL
          AND customer_id IS NOT NULL AND created_at::date <= $2
        GROUP BY customer_id`,
      [tenantId, upTo],
    );
    const out = new Map<string, string>();
    for (const r of rows) if (!out.get(r.id) || r.last > out.get(r.id)!) out.set(r.id, r.last);
    return out;
  }

  async returns(ctx: AnalyticsContext) {
    const facts = await ctx.facts();
    const docs = summarizeDocs(facts);
    const returnDocs = new Set(docs.filter((d) => d.net < 0).map((d) => `${d.source}:${d.docId}`));
    const names = await ctx.names();
    const m = new Map<string, { qty: number; value: number; docs: Set<string>; sales: number }>();
    for (const f of facts) {
      const key = `${f.source}:${f.docId}`;
      const a = m.get(f.productId) ?? { qty: 0, value: 0, docs: new Set<string>(), sales: 0 };
      if (returnDocs.has(key)) {
        a.qty = r4(a.qty - f.quantity);
        a.value = r4(a.value - f.net);
        a.docs.add(key);
      } else a.sales = r4(a.sales + f.net);
      m.set(f.productId, a);
    }
    const rows = [...m.entries()]
      .filter(([, a]) => a.docs.size > 0)
      .map(([id, a]) => {
        const p = names.products.get(id);
        return {
          productId: id,
          code: p?.code ?? null,
          name: p?.name ?? id,
          returnQty: a.qty,
          returnValue: a.value,
          returnDocuments: a.docs.size,
          sales: a.sales,
          returnPct: sharePct(a.value, a.sales),
        };
      })
      .sort((a, b) => b.returnValue - a.returnValue);
    const t = periodTotals(facts);
    return { period: ctx.scope.period, rows, totals: { sales: t.sales, returns: t.returns, returnPct: sharePct(t.returns, t.sales) } };
  }

  async dailySales(ctx: AnalyticsContext) {
    const docs = summarizeDocs(await ctx.facts());
    const m = new Map<string, any>();
    for (const d of docs) {
      const r = m.get(d.date) ?? { date: d.date, invoiceCount: 0, sales: 0, returns: 0, netSales: 0, cost: 0 };
      if (d.net > 0) {
        r.invoiceCount += 1;
        r.sales = r4(r.sales + d.net);
      } else r.returns = r4(r.returns - d.net);
      r.netSales = r4(r.sales - r.returns);
      r.cost = r4(r.cost + d.cost);
      m.set(d.date, r);
    }
    const rows = [...m.values()]
      .map((r) => {
        const profit = r4(r.netSales - r.cost);
        return { ...r, profit, margin: marginPct(r.netSales, profit), averageInvoice: r.invoiceCount ? r4(r.sales / r.invoiceCount) : 0 };
      })
      .sort((a, b) => a.date.localeCompare(b.date));
    return { period: ctx.scope.period, rows };
  }

  async salesByUser(ctx: AnalyticsContext) {
    const docs = summarizeDocs(await ctx.facts());
    const names = await ctx.names();
    const m = new Map<string, any>();
    for (const d of docs) {
      const key = d.userId ?? '';
      const r =
        m.get(key) ??
        { userId: d.userId, name: (d.userId && names.users.get(d.userId)) || 'Unknown', invoiceCount: 0, sales: 0, returns: 0, netSales: 0, discounts: 0, cost: 0 };
      if (d.net > 0) {
        r.invoiceCount += 1;
        r.sales = r4(r.sales + d.net);
      } else r.returns = r4(r.returns - d.net);
      r.netSales = r4(r.sales - r.returns);
      r.discounts = r4(r.discounts + d.discount);
      r.cost = r4(r.cost + d.cost);
      m.set(key, r);
    }
    const rows = [...m.values()]
      .map((r) => {
        const profit = r4(r.netSales - r.cost);
        return { ...r, profit, margin: marginPct(r.netSales, profit), averageInvoice: r.invoiceCount ? r4(r.sales / r.invoiceCount) : 0 };
      })
      .sort((a, b) => b.netSales - a.netSales);
    return { period: ctx.scope.period, rows };
  }

  async dashboard(ctx: AnalyticsContext) {
    const kpi = await this.kpi(ctx);
    const items = await this.items(ctx);
    const customers = await this.customers(ctx);
    const daily = await this.dailySales(ctx);
    return {
      kpi,
      topSelling: items.topSelling.slice(0, 5),
      topProfit: items.topProfit.slice(0, 5),
      topCustomers: customers.top.slice(0, 5),
      dailySales: daily.rows,
    };
  }

  async insights(ctx: AnalyticsContext, canSeeProfit: boolean): Promise<{ period: Period; insights: Insight[] }> {
    const s = ctx.scope;
    const kpi = (await this.kpi(ctx)) as Record<string, any>;
    const items = await this.items(ctx);
    const slow = await this.slowMoving(ctx);
    const customers = await this.customers(ctx);
    const returns = await this.returns(ctx);
    const suggestions = await this.purchaseSuggestions(ctx);
    const cash = await this.posCashDifferences(s);
    const treasuries = await this.treasuryBalances(s.tenantId, s.branchId);
    const top = items.topSelling[0];
    const topCustomer = customers.top[0];
    const worst = cash.find((c) => c.absDifference > 0);

    const insights = buildInsights(
      {
        sales: kpi.sales as number,
        returns: kpi.returns as number,
        prevReturns: kpi.prevReturns as number,
        netSales: kpi.netSales as number,
        prevNetSales: kpi.prevNetSales as number,
        grossProfit: kpi.grossProfit as number,
        prevGrossProfit: kpi.prevGrossProfit as number,
        margin: kpi.margin,
        prevMargin: kpi.prevMargin,
        expenses: kpi.expenses,
        stockValue: kpi.stockValue,
        outOfStockCount: kpi.outOfStockCount,
        lowStockCount: kpi.lowStockCount,
        slowCount: slow.rows.length,
        slowValue: slow.slowValue,
        overstockCount: kpi.overstockCount,
        highMarginLowSales: {
          count: items.highMarginLowSales.length,
          topName: items.highMarginLowSales[0]?.name,
          topMargin: items.highMarginLowSales[0]?.margin,
        },
        highSalesLowMargin: {
          count: items.highSalesLowMargin.length,
          topName: items.highSalesLowMargin[0]?.name,
          topMargin: items.highSalesLowMargin[0]?.margin,
        },
        topItem: top ? { name: top.name, sales: top.sales } : undefined,
        topCustomer: topCustomer ? { name: topCustomer.name, sales: topCustomer.sales } : undefined,
        lostCustomers: {
          count: customers.lost.length,
          prevSales: r4(customers.lost.reduce((sum, c) => sum + c.prevSales, 0)),
        },
        topReturnItem: returns.rows[0]?.name,
        purchaseSuggestions: { count: suggestions.rows.length, expectedCost: suggestions.expectedCost },
        worstCashDifference: worst ? { userName: worst.userName, amount: worst.absDifference } : undefined,
        negativeTreasuries: treasuries.filter((t) => t.balance < 0).map((t) => `${t.code} ${t.name}`),
      },
      thresholdsOf(s.settings, s.overstockDays, s.coverDays),
      canSeeProfit,
    );
    return { period: s.period, insights };
  }
}

export type { AnalyticsContext, Names };
