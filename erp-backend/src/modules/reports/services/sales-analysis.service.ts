import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SalesInvoice } from '@modules/sales/entities/sales-invoice.entity';
import { round } from '@shared/utils/document-totals.util';
import { SqlParams } from './ledger-sql';

export type SalesGroupBy =
  | 'product'
  | 'customer'
  | 'category'
  | 'branch'
  | 'salesperson'
  | 'month'
  | 'invoice'
  | 'day';
export type PurchaseGroupBy = 'supplier' | 'product' | 'category' | 'branch' | 'month' | 'invoice';

export interface SalesFact {
  source: 'invoice' | 'pos';
  docId: string;
  number: string;
  date: string;
  partnerId: string | null;
  productId: string;
  categoryId: string | null;
  branchId: string | null;
  userId: string | null;
  quantity: number;
  net: number;
  tax: number;
  cost: number;
  costSource: 'stock_moves' | 'product_cost' | 'none';
  /** Line discount in base currency (signed like `net`). */
  discount?: number;
}

export interface AnalysisRow {
  key: string;
  code?: string | null;
  name: string;
  date?: string;
  documents: number;
  quantity: number;
  net: number;
  tax: number;
  total: number;
  cost?: number;
  grossProfit?: number;
  margin?: number | null;
}

export interface Names {
  products: Map<string, { code: string; name: string; categoryId: string | null }>;
  partners: Map<string, { code: string; name: string }>;
  categories: Map<string, string>;
  branches: Map<string, { code: string; name: string }>;
  users: Map<string, string>;
}

const r4 = (n: number) => round(n, 4);

/** Groups facts by a dimension and sums quantities, amounts and margins. */
export function aggregate(
  facts: SalesFact[],
  keyOf: (f: SalesFact) => string,
  labelOf: (key: string, f: SalesFact) => Pick<AnalysisRow, 'code' | 'name' | 'date'>,
  withCost: boolean,
): AnalysisRow[] {
  const rows = new Map<string, AnalysisRow & { docs: Set<string> }>();
  for (const f of facts) {
    const key = keyOf(f);
    const row =
      rows.get(key) ??
      ({
        key,
        ...labelOf(key, f),
        documents: 0,
        quantity: 0,
        net: 0,
        tax: 0,
        total: 0,
        ...(withCost ? { cost: 0, grossProfit: 0, margin: null } : {}),
        docs: new Set<string>(),
      } as AnalysisRow & { docs: Set<string> });
    row.docs.add(`${f.source}:${f.docId}`);
    row.quantity = r4(row.quantity + f.quantity);
    row.net = r4(row.net + f.net);
    row.tax = r4(row.tax + f.tax);
    row.total = r4(row.net + row.tax);
    if (withCost) row.cost = r4((row.cost ?? 0) + f.cost);
    rows.set(key, row);
  }
  return [...rows.values()].map(({ docs, ...row }) => {
    row.documents = docs.size;
    if (withCost) {
      row.grossProfit = r4(row.net - (row.cost ?? 0));
      row.margin = row.net ? round((row.grossProfit / row.net) * 100, 2) : null;
    }
    return row;
  });
}

function sumRows(rows: AnalysisRow[], withCost: boolean) {
  const t = {
    documents: rows.reduce((s, r) => s + r.documents, 0),
    quantity: r4(rows.reduce((s, r) => s + r.quantity, 0)),
    net: r4(rows.reduce((s, r) => s + r.net, 0)),
    tax: r4(rows.reduce((s, r) => s + r.tax, 0)),
    total: r4(rows.reduce((s, r) => s + r.total, 0)),
  };
  if (!withCost) return t;
  const cost = r4(rows.reduce((s, r) => s + (r.cost ?? 0), 0));
  const grossProfit = r4(t.net - cost);
  return { ...t, cost, grossProfit, margin: t.net ? round((grossProfit / t.net) * 100, 2) : null };
}

/**
 * Sales and purchase analysis from documents (posted invoices, credit notes,
 * POS orders and vendor bills), the daily sales/cash summary, and the
 * building blocks of the dashboard's top products.
 *
 * Amounts are untaxed and converted to base currency with the document's
 * exchange rate. Gross profit uses the cost of the stock moves that delivered
 * the goods (sales order deliveries, POS orders); invoices without a delivery
 * fall back to the product's current cost (`costSource`).
 */
@Injectable()
export class SalesAnalysisService {
  constructor(
    @InjectRepository(SalesInvoice)
    private readonly salesInvoiceRepo: Repository<SalesInvoice>,
  ) {}

  private query<T = any>(sql: string, params: unknown[]): Promise<T[]> {
    return this.salesInvoiceRepo.query(sql, params);
  }

  async salesFacts(
    tenantId: string,
    q: {
      from?: string;
      to?: string;
      source?: 'all' | 'invoices' | 'pos';
      branchId?: string;
      customerId?: string;
      productId?: string;
      categoryId?: string;
      /** Invoices: warehouse of the delivering sales order; POS: terminal warehouse. */
      warehouseId?: string;
    },
  ): Promise<SalesFact[]> {
    const facts: SalesFact[] = [];
    const source = q.source ?? 'all';

    if (source !== 'pos') {
      const p = new SqlParams();
      const where = [
        `i.tenant_id = ${p.add(tenantId)}`,
        `i.status NOT IN ('draft', 'cancelled')`,
      ];
      if (q.from) where.push(`i.date >= ${p.add(q.from)}`);
      if (q.to) where.push(`i.date <= ${p.add(q.to)}`);
      if (q.branchId) where.push(`i.branch_id = ${p.add(q.branchId)}`);
      if (q.customerId) where.push(`i.customer_id = ${p.add(q.customerId)}`);
      if (q.productId) where.push(`l.product_id = ${p.add(q.productId)}`);
      if (q.categoryId) where.push(`pr.category_id = ${p.add(q.categoryId)}`);
      if (q.warehouseId) {
        where.push(
          `EXISTS (SELECT 1 FROM sales_orders wso WHERE wso.id = COALESCE(i.order_id, ri.order_id)
                     AND wso.warehouse_id = ${p.add(q.warehouseId)})`,
        );
      }
      const lines = await this.query(
        `SELECT i.id AS "docId", i.invoice_number AS number, to_char(i.date, 'YYYY-MM-DD') AS date,
                i.customer_id AS "partnerId", i.branch_id AS "branchId", i.created_by AS "userId",
                i.move_type AS "moveType", i.exchange_rate AS rate,
                COALESCE(i.order_id, ri.order_id) AS "orderId",
                l.product_id AS "productId", l.quantity AS quantity, l.line_total AS "lineTotal",
                l.discount AS discount, l.tax_rate AS "taxRate", pr.category_id AS "categoryId", pr.type AS "productType",
                pr.cost_price AS "costPrice"
           FROM sales_invoice_lines l
           JOIN sales_invoices i ON i.id = l.invoice_id
           LEFT JOIN sales_invoices ri ON ri.id = i.reversed_invoice_id
           LEFT JOIN products pr ON pr.id = l.product_id
          WHERE ${where.join(' AND ')}`,
        p.values,
      );

      const orderIds = [...new Set(lines.map((l) => l.orderId).filter(Boolean))];
      const moveCost = await this.unitCostsByReference(tenantId, ['sales_order'], orderIds);

      for (const l of lines) {
        const sign = l.moveType === 'credit_note' ? -1 : 1;
        const rate = Number(l.rate) || 1;
        const qty = Number(l.quantity) * sign;
        const net = Number(l.lineTotal) * sign * rate;
        const fromMoves = l.orderId ? moveCost.get(`${l.orderId}|${l.productId}`) : undefined;
        let unitCost = 0;
        let costSource: SalesFact['costSource'] = 'none';
        if (fromMoves !== undefined) {
          unitCost = fromMoves;
          costSource = 'stock_moves';
        } else if (l.productType === 'goods') {
          unitCost = Number(l.costPrice) || 0;
          costSource = 'product_cost';
        }
        facts.push({
          source: 'invoice',
          docId: l.docId,
          number: l.number,
          date: l.date,
          partnerId: l.partnerId,
          productId: l.productId,
          categoryId: l.categoryId,
          branchId: l.branchId,
          userId: l.userId,
          quantity: r4(qty),
          net: r4(net),
          tax: r4((net * Number(l.taxRate)) / 100),
          cost: r4(qty * unitCost),
          costSource,
          discount: r4(Number(l.discount || 0) * sign * rate),
        });
      }
    }

    if (source !== 'invoices') {
      const p = new SqlParams();
      const where = [`o.tenant_id = ${p.add(tenantId)}`, `o.status IN ('completed', 'refunded')`];
      if (q.from) where.push(`o.created_at::date >= ${p.add(q.from)}`);
      if (q.to) where.push(`o.created_at::date <= ${p.add(q.to)}`);
      if (q.branchId) where.push(`t.branch_id = ${p.add(q.branchId)}`);
      if (q.customerId) where.push(`o.customer_id = ${p.add(q.customerId)}`);
      if (q.productId) where.push(`l.product_id = ${p.add(q.productId)}`);
      if (q.categoryId) where.push(`pr.category_id = ${p.add(q.categoryId)}`);
      if (q.warehouseId) where.push(`t.warehouse_id = ${p.add(q.warehouseId)}`);
      const lines = await this.query(
        `SELECT o.id AS "docId", o.order_number AS number, to_char(o.created_at, 'YYYY-MM-DD') AS date,
                o.customer_id AS "partnerId", t.branch_id AS "branchId", o.created_by AS "userId",
                o.refunded_order_id AS "refundedOrderId",
                l.product_id AS "productId", l.quantity AS quantity,
                (l.quantity * l.unit_price - l.discount) AS "lineTotal", l.discount AS discount,
                l.tax_rate AS "taxRate", pr.category_id AS "categoryId", pr.type AS "productType",
                pr.cost_price AS "costPrice"
           FROM pos_order_lines l
           JOIN pos_orders o ON o.id = l.order_id
           LEFT JOIN pos_sessions s ON s.id = o.session_id
           LEFT JOIN pos_terminals t ON t.id = s.terminal_id
           LEFT JOIN products pr ON pr.id = l.product_id
          WHERE ${where.join(' AND ')}`,
        p.values,
      );
      const moveCost = await this.unitCostsByReference(
        tenantId,
        ['pos_order', 'pos_refund'],
        [...new Set(lines.map((l) => l.docId))],
      );
      // POS line_total includes VAT; the untaxed amount is quantity × price − discount
      for (const l of lines) {
        const qty = Number(l.quantity);
        const net = Number(l.lineTotal);
        const fromMoves = moveCost.get(`${l.docId}|${l.productId}`);
        let unitCost = 0;
        let costSource: SalesFact['costSource'] = 'none';
        if (fromMoves !== undefined) {
          unitCost = fromMoves;
          costSource = 'stock_moves';
        } else if (l.productType === 'goods') {
          unitCost = Number(l.costPrice) || 0;
          costSource = 'product_cost';
        }
        facts.push({
          source: 'pos',
          docId: l.docId,
          number: l.number,
          date: l.date,
          partnerId: l.partnerId,
          productId: l.productId,
          categoryId: l.categoryId,
          branchId: l.branchId,
          userId: l.userId,
          quantity: r4(qty),
          net: r4(net),
          tax: r4((net * Number(l.taxRate)) / 100),
          cost: r4(qty * unitCost),
          costSource,
          // refund lines store a negative discount already
          discount: r4(Number(l.discount || 0)),
        });
      }
    }
    return facts;
  }

  /** Weighted average unit cost of the stock moves of documents, per document and product. */
  private async unitCostsByReference(
    tenantId: string,
    referenceTypes: string[],
    referenceIds: string[],
  ): Promise<Map<string, number>> {
    if (!referenceIds.length) return new Map();
    const rows = await this.query(
      `SELECT reference_id AS "referenceId", product_id AS "productId",
              SUM(ABS(quantity) * unit_cost) AS value, SUM(ABS(quantity)) AS qty
         FROM stock_movements
        WHERE tenant_id = $1 AND reference_type = ANY($2::text[]) AND reference_id = ANY($3::uuid[])
        GROUP BY reference_id, product_id`,
      [tenantId, referenceTypes, referenceIds],
    );
    const out = new Map<string, number>();
    for (const r of rows) {
      const qty = Number(r.qty);
      if (qty > 0) out.set(`${r.referenceId}|${r.productId}`, Number(r.value) / qty);
    }
    return out;
  }

  async names(tenantId: string): Promise<Names> {
    // Sequential: the request runs on a single transactional connection
    const products = await this.query(`SELECT id, code, name_ar, name_en, category_id FROM products WHERE tenant_id = $1`, [tenantId]);
    const customers = await this.query(`SELECT id, code, name_ar, name_en FROM customers WHERE tenant_id = $1`, [tenantId]);
    const categories = await this.query(`SELECT id, name_ar, name_en FROM categories WHERE tenant_id = $1`, [tenantId]);
    const branches = await this.query(`SELECT id, code, name FROM branches WHERE tenant_id = $1`, [tenantId]);
    const users = await this.query(`SELECT id, name FROM users WHERE tenant_id = $1`, [tenantId]);
    return {
      products: new Map(
        products.map((p) => [p.id, { code: p.code, name: p.name_en || p.name_ar, categoryId: p.category_id }]),
      ),
      partners: new Map(customers.map((c) => [c.id, { code: c.code, name: c.name_en || c.name_ar }])),
      categories: new Map(categories.map((c) => [c.id, c.name_en || c.name_ar])),
      branches: new Map(branches.map((b) => [b.id, { code: b.code, name: b.name }])),
      users: new Map(users.map((u) => [u.id, u.name])),
    };
  }

  async salesAnalysis(
    tenantId: string,
    q: Parameters<SalesAnalysisService['salesFacts']>[1] & { groupBy?: SalesGroupBy; limit?: number },
  ) {
    const groupBy = q.groupBy ?? 'product';
    const facts = await this.salesFacts(tenantId, q);
    const names = await this.names(tenantId);
    const none = (label: string) => ({ code: null, name: label });
    const productLabel = (k: string) => {
      const p = names.products.get(k);
      return p ? { code: p.code, name: p.name } : none(k);
    };

    const dims: Record<
      SalesGroupBy,
      [(f: SalesFact) => string, (k: string, f: SalesFact) => Pick<AnalysisRow, 'code' | 'name' | 'date'>]
    > = {
      product: [(f) => f.productId, (k) => productLabel(k)],
      customer: [
        (f) => f.partnerId ?? '',
        (k) => (k ? names.partners.get(k) ?? none(k) : none('Walk-in customer')),
      ],
      category: [
        (f) => f.categoryId ?? '',
        (k) => (k ? { code: null, name: names.categories.get(k) ?? k } : none('Uncategorised')),
      ],
      branch: [(f) => f.branchId ?? '', (k) => (k ? names.branches.get(k) ?? none(k) : none('No branch'))],
      salesperson: [
        (f) => f.userId ?? '',
        (k) => (k ? { code: null, name: names.users.get(k) ?? k } : none('Unknown')),
      ],
      month: [(f) => f.date.slice(0, 7), (k) => ({ code: null, name: k })],
      day: [(f) => f.date, (k) => ({ code: null, name: k, date: k })],
      invoice: [
        (f) => `${f.source}:${f.docId}`,
        (_k, f) => ({
          code: f.number,
          date: f.date,
          name: f.partnerId ? names.partners.get(f.partnerId)?.name ?? '' : 'Walk-in customer',
        }),
      ],
    };
    const [keyOf, labelOf] = dims[groupBy];
    let rows = aggregate(facts, keyOf, labelOf, true);
    rows.sort((a, b) =>
      groupBy === 'month' || groupBy === 'day' || groupBy === 'invoice'
        ? (a.date ?? a.name).localeCompare(b.date ?? b.name) || (a.code ?? '').localeCompare(b.code ?? '')
        : b.net - a.net,
    );
    const totals = sumRows(rows, true);
    if (q.limit) rows = rows.slice(0, q.limit);
    return {
      groupBy,
      from: q.from ?? null,
      to: q.to ?? null,
      source: q.source ?? 'all',
      rows,
      totals,
      costFallbackLines: facts.filter((f) => f.costSource === 'product_cost').length,
    };
  }

  async purchaseAnalysis(
    tenantId: string,
    q: {
      from?: string;
      to?: string;
      groupBy?: PurchaseGroupBy;
      branchId?: string;
      supplierId?: string;
      productId?: string;
      limit?: number;
    },
  ) {
    const groupBy = q.groupBy ?? 'supplier';
    const p = new SqlParams();
    const where = [`i.tenant_id = ${p.add(tenantId)}`, `i.status NOT IN ('draft', 'cancelled')`];
    if (q.from) where.push(`i.date >= ${p.add(q.from)}`);
    if (q.to) where.push(`i.date <= ${p.add(q.to)}`);
    if (q.branchId) where.push(`i.branch_id = ${p.add(q.branchId)}`);
    if (q.supplierId) where.push(`i.supplier_id = ${p.add(q.supplierId)}`);
    if (q.productId) where.push(`l.product_id = ${p.add(q.productId)}`);
    const lines = await this.query(
      `SELECT i.id AS "docId", i.invoice_number AS number, to_char(i.date, 'YYYY-MM-DD') AS date,
              i.supplier_id AS "partnerId", i.branch_id AS "branchId", i.created_by AS "userId",
              i.move_type AS "moveType", i.exchange_rate AS rate, l.product_id AS "productId",
              l.quantity AS quantity, l.line_total AS "lineTotal", l.tax_rate AS "taxRate",
              pr.category_id AS "categoryId"
         FROM purchase_invoice_lines l
         JOIN purchase_invoices i ON i.id = l.invoice_id
         LEFT JOIN products pr ON pr.id = l.product_id
        WHERE ${where.join(' AND ')}`,
      p.values,
    );
    const facts: SalesFact[] = lines.map((l) => {
      const sign = l.moveType === 'refund' ? -1 : 1;
      const net = Number(l.lineTotal) * sign * (Number(l.rate) || 1);
      return {
        source: 'invoice',
        docId: l.docId,
        number: l.number,
        date: l.date,
        partnerId: l.partnerId,
        productId: l.productId,
        categoryId: l.categoryId,
        branchId: l.branchId,
        userId: l.userId,
        quantity: r4(Number(l.quantity) * sign),
        net: r4(net),
        tax: r4((net * Number(l.taxRate)) / 100),
        cost: 0,
        costSource: 'none',
      };
    });

    const names = await this.names(tenantId);
    const productLabel = (k: string) => {
      const p = names.products.get(k);
      return p ? { code: p.code, name: p.name } : { code: null, name: k };
    };
    const suppliers: { id: string; code: string; name_ar: string; name_en: string }[] = await this.query(
      `SELECT id, code, name_ar, name_en FROM suppliers WHERE tenant_id = $1`,
      [tenantId],
    );
    const supplierNames = new Map(suppliers.map((s) => [s.id, { code: s.code, name: s.name_en || s.name_ar }]));
    const none = (label: string) => ({ code: null, name: label });
    const dims: Record<
      PurchaseGroupBy,
      [(f: SalesFact) => string, (k: string, f: SalesFact) => Pick<AnalysisRow, 'code' | 'name' | 'date'>]
    > = {
      supplier: [(f) => f.partnerId ?? '', (k) => supplierNames.get(k) ?? none(k)],
      product: [(f) => f.productId, (k) => productLabel(k)],
      category: [
        (f) => f.categoryId ?? '',
        (k) => (k ? { code: null, name: names.categories.get(k) ?? k } : none('Uncategorised')),
      ],
      branch: [(f) => f.branchId ?? '', (k) => (k ? names.branches.get(k) ?? none(k) : none('No branch'))],
      month: [(f) => f.date.slice(0, 7), (k) => ({ code: null, name: k })],
      invoice: [
        (f) => f.docId,
        (_k, f) => ({
          code: f.number,
          date: f.date,
          name: (f.partnerId && supplierNames.get(f.partnerId)?.name) || '',
        }),
      ],
    };
    const [keyOf, labelOf] = dims[groupBy];
    let rows = aggregate(facts, keyOf, labelOf, false).map((r) => ({
      ...r,
      averageUnitCost: r.quantity ? r4(r.net / r.quantity) : null,
    }));
    rows.sort((a, b) =>
      groupBy === 'month' || groupBy === 'invoice'
        ? (a.date ?? a.name).localeCompare(b.date ?? b.name)
        : b.net - a.net,
    );
    const totals = sumRows(rows, false);
    if (q.limit) rows = rows.slice(0, q.limit);
    return { groupBy, from: q.from ?? null, to: q.to ?? null, rows, totals };
  }

  /**
   * Daily sales and cash summary per day and user: invoices, POS sales (cash
   * and card), customer receipts and supplier payments by cash / non-cash.
   * With a branch filter, payments (which carry no branch) are left out.
   */
  async dailySummary(
    tenantId: string,
    q: { from?: string; to?: string; branchId?: string; userId?: string },
  ) {
    type Row = {
      date: string;
      userId: string | null;
      userName: string;
      invoiceCount: number;
      invoiceNet: number;
      invoiceTotal: number;
      posCount: number;
      posTotal: number;
      posCash: number;
      posCard: number;
      receiptsCash: number;
      receiptsBank: number;
      paymentsCash: number;
      paymentsBank: number;
      netCash: number;
    };
    const rows = new Map<string, Row>();
    const row = (date: string, userId: string | null) => {
      const key = `${date}|${userId ?? ''}`;
      let r = rows.get(key);
      if (!r) {
        r = {
          date,
          userId,
          userName: '',
          invoiceCount: 0,
          invoiceNet: 0,
          invoiceTotal: 0,
          posCount: 0,
          posTotal: 0,
          posCash: 0,
          posCard: 0,
          receiptsCash: 0,
          receiptsBank: 0,
          paymentsCash: 0,
          paymentsBank: 0,
          netCash: 0,
        };
        rows.set(key, r);
      }
      return r;
    };

    {
      const p = new SqlParams();
      const where = [`i.tenant_id = ${p.add(tenantId)}`, `i.status NOT IN ('draft', 'cancelled')`];
      if (q.from) where.push(`i.date >= ${p.add(q.from)}`);
      if (q.to) where.push(`i.date <= ${p.add(q.to)}`);
      if (q.branchId) where.push(`i.branch_id = ${p.add(q.branchId)}`);
      if (q.userId) where.push(`i.created_by = ${p.add(q.userId)}`);
      const inv = await this.query(
        `SELECT to_char(i.date, 'YYYY-MM-DD') AS date, i.created_by AS "userId", COUNT(*) AS count,
                SUM(CASE WHEN i.move_type = 'credit_note' THEN -1 ELSE 1 END * i.subtotal * i.exchange_rate) AS net,
                SUM(CASE WHEN i.move_type = 'credit_note' THEN -1 ELSE 1 END * i.total_amount * i.exchange_rate) AS total
           FROM sales_invoices i WHERE ${where.join(' AND ')} GROUP BY 1, 2`,
        p.values,
      );
      for (const r of inv) {
        const x = row(r.date, r.userId);
        x.invoiceCount += Number(r.count);
        x.invoiceNet = r4(x.invoiceNet + Number(r.net));
        x.invoiceTotal = r4(x.invoiceTotal + Number(r.total));
      }
    }
    {
      const p = new SqlParams();
      const where = [`o.tenant_id = ${p.add(tenantId)}`, `o.status IN ('completed', 'refunded')`];
      if (q.from) where.push(`o.created_at::date >= ${p.add(q.from)}`);
      if (q.to) where.push(`o.created_at::date <= ${p.add(q.to)}`);
      if (q.branchId) where.push(`t.branch_id = ${p.add(q.branchId)}`);
      if (q.userId) where.push(`o.created_by = ${p.add(q.userId)}`);
      const pos = await this.query(
        `SELECT to_char(o.created_at, 'YYYY-MM-DD') AS date, o.created_by AS "userId", COUNT(*) AS count,
                SUM(o.total_amount) AS total, SUM(o.cash_amount) AS cash
           FROM pos_orders o
           LEFT JOIN pos_sessions s ON s.id = o.session_id
           LEFT JOIN pos_terminals t ON t.id = s.terminal_id
          WHERE ${where.join(' AND ')} GROUP BY 1, 2`,
        p.values,
      );
      for (const r of pos) {
        const x = row(r.date, r.userId);
        x.posCount += Number(r.count);
        x.posTotal = r4(x.posTotal + Number(r.total));
        x.posCash = r4(x.posCash + Number(r.cash));
        x.posCard = r4(x.posTotal - x.posCash);
      }
    }
    if (!q.branchId) {
      const p = new SqlParams();
      const where = [`tenant_id = ${p.add(tenantId)}`, `status = 'posted'`];
      if (q.from) where.push(`date >= ${p.add(q.from)}`);
      if (q.to) where.push(`date <= ${p.add(q.to)}`);
      if (q.userId) where.push(`created_by = ${p.add(q.userId)}`);
      const pays = await this.query(
        `SELECT to_char(date, 'YYYY-MM-DD') AS date, created_by AS "userId", direction,
                (method = 'cash') AS "isCash", SUM(amount) AS amount
           FROM payments WHERE ${where.join(' AND ')} GROUP BY 1, 2, 3, 4`,
        p.values,
      );
      for (const r of pays) {
        const x = row(r.date, r.userId);
        const amount = Number(r.amount);
        if (r.direction === 'inbound') {
          if (r.isCash) x.receiptsCash = r4(x.receiptsCash + amount);
          else x.receiptsBank = r4(x.receiptsBank + amount);
        } else if (r.isCash) x.paymentsCash = r4(x.paymentsCash + amount);
        else x.paymentsBank = r4(x.paymentsBank + amount);
      }
    }

    const users: { id: string; name: string }[] = await this.query(
      `SELECT id, name FROM users WHERE tenant_id = $1`,
      [tenantId],
    );
    const userNames = new Map(users.map((u) => [u.id, u.name]));
    const list = [...rows.values()]
      .map((r) => ({
        ...r,
        userName: (r.userId && userNames.get(r.userId)) || '',
        netCash: r4(r.posCash + r.receiptsCash - r.paymentsCash),
      }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.userName.localeCompare(b.userName));

    const numeric = [
      'invoiceCount',
      'invoiceNet',
      'invoiceTotal',
      'posCount',
      'posTotal',
      'posCash',
      'posCard',
      'receiptsCash',
      'receiptsBank',
      'paymentsCash',
      'paymentsBank',
      'netCash',
    ] as const;
    const totals = Object.fromEntries(
      numeric.map((k) => [k, r4(list.reduce((s, r) => s + (r[k] as number), 0))]),
    ) as Record<(typeof numeric)[number], number>;

    return { from: q.from ?? null, to: q.to ?? null, rows: list, totals };
  }
}
