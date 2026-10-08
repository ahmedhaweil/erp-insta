import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, LessThanOrEqual, MoreThanOrEqual, Not, Repository } from 'typeorm';
import { SalesRep } from '../entities/sales-rep.entity';
import { CommissionBasis, CommissionRule } from '../entities/commission-rule.entity';
import {
  CommissionStatement,
  CommissionStatementLine,
  CommissionStatementStatus,
} from '../entities/commission-statement.entity';
import {
  SalesInvoice,
  SalesInvoiceStatus,
  SalesInvoiceType,
} from '../entities/sales-invoice.entity';
import {
  CommissionPeriodDto,
  CreateCommissionRuleDto,
  CreateSalesRepDto,
  PostCommissionDto,
  UpdateCommissionRuleDto,
  UpdateSalesRepDto,
} from '../dto/sales-rep.dto';
import { Product } from '@modules/inventory/entities/product.entity';
import { AutoPostingService } from '@modules/accounting/services/auto-posting.service';
import { JournalType } from '@modules/accounting/entities/journal.entity';
import { SequenceService } from '@shared/services/sequence.service';
import { round } from '@shared/utils/document-totals.util';

/** Untaxed amount of an invoice line attributable to a commission basis. */
export interface CommissionBaseItem {
  invoiceId: string;
  invoiceNumber: string;
  productCategoryId: string | null;
  basis: CommissionBasis;
  amount: number;
}

export interface CommissionComputation {
  salesRepId: string;
  periodFrom: string;
  periodTo: string;
  collectedAmount: number;
  invoicedAmount: number;
  commissionAmount: number;
  lines: CommissionStatementLine[];
}

/**
 * Sales representatives, commission rules and commission statements.
 *
 * Commission is computed per period on the untaxed share of either amounts
 * collected (payments allocated to the rep's invoices, dated in the period)
 * or invoiced amounts net of credit notes. Posting a statement accrues it:
 * Dr commission expense / Cr commission payable.
 */
@Injectable()
export class CommissionsService {
  constructor(
    @InjectRepository(SalesRep)
    private readonly repRepo: Repository<SalesRep>,
    @InjectRepository(CommissionRule)
    private readonly ruleRepo: Repository<CommissionRule>,
    @InjectRepository(CommissionStatement)
    private readonly statementRepo: Repository<CommissionStatement>,
    @InjectRepository(SalesInvoice)
    private readonly invoiceRepo: Repository<SalesInvoice>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    private readonly autoPosting: AutoPostingService,
    private readonly sequenceService: SequenceService,
  ) {}

  // ---------------------------------------------------------------- reps

  async createRep(tenantId: string, dto: CreateSalesRepDto): Promise<SalesRep> {
    const duplicate = await this.repRepo.findOne({ where: { tenantId, code: dto.code } });
    if (duplicate) throw new ConflictException(`Sales rep code ${dto.code} already exists`);
    return this.repRepo.save(this.repRepo.create({ ...dto, tenantId }));
  }

  findReps(tenantId: string): Promise<SalesRep[]> {
    return this.repRepo.find({ where: { tenantId }, order: { code: 'ASC' } });
  }

  async findRep(tenantId: string, id: string): Promise<SalesRep> {
    const rep = await this.repRepo.findOne({ where: { id, tenantId } });
    if (!rep) throw new NotFoundException('Sales rep not found');
    return rep;
  }

  async updateRep(tenantId: string, id: string, dto: UpdateSalesRepDto): Promise<SalesRep> {
    const rep = await this.findRep(tenantId, id);
    Object.assign(rep, dto);
    return this.repRepo.save(rep);
  }

  // --------------------------------------------------------------- rules

  async createRule(tenantId: string, dto: CreateCommissionRuleDto): Promise<CommissionRule> {
    if (dto.salesRepId) await this.findRep(tenantId, dto.salesRepId);
    return this.ruleRepo.save(this.ruleRepo.create({ ...dto, tenantId }));
  }

  findRules(tenantId: string, salesRepId?: string): Promise<CommissionRule[]> {
    const where: Record<string, unknown> = { tenantId };
    if (salesRepId) where.salesRepId = salesRepId;
    return this.ruleRepo.find({ where, order: { createdAt: 'ASC' } });
  }

  async updateRule(tenantId: string, id: string, dto: UpdateCommissionRuleDto): Promise<CommissionRule> {
    const rule = await this.ruleRepo.findOne({ where: { id, tenantId } });
    if (!rule) throw new NotFoundException('Commission rule not found');
    Object.assign(rule, dto);
    return this.ruleRepo.save(rule);
  }

  // ------------------------------------------------------- computation

  /**
   * Picks the rule for a (rep, category, basis): the most specific scope
   * wins, then within that scope the highest target reached by the rep's
   * period total. Returns null when no tier of the best scope is reached.
   */
  static pickRule(
    rules: CommissionRule[],
    salesRepId: string,
    categoryId: string | null,
    basis: CommissionBasis,
    periodTotal: number,
  ): CommissionRule | null {
    const scope = (r: CommissionRule): number => {
      if (r.salesRepId && r.salesRepId !== salesRepId) return -1;
      if (r.productCategoryId && r.productCategoryId !== categoryId) return -1;
      if (r.salesRepId && r.productCategoryId) return 0;
      if (r.productCategoryId) return 1;
      if (r.salesRepId) return 2;
      return 3;
    };
    const candidates = rules
      .filter((r) => r.isActive !== false && r.basis === basis)
      .map((r) => ({ r, s: scope(r) }))
      .filter((x) => x.s >= 0);
    if (candidates.length === 0) return null;
    const best = Math.min(...candidates.map((x) => x.s));
    const tiers = candidates
      .filter((x) => x.s === best && Number(x.r.targetAmount || 0) <= periodTotal + 0.0001)
      .sort((a, b) => Number(b.r.targetAmount || 0) - Number(a.r.targetAmount || 0));
    return tiers[0]?.r ?? null;
  }

  /** Applies the rules to the base items (pure, unit-tested). */
  static computeFromItems(
    rules: CommissionRule[],
    salesRepId: string,
    items: CommissionBaseItem[],
  ): { lines: CommissionStatementLine[]; collected: number; invoiced: number; commission: number } {
    const totals: Record<CommissionBasis, number> = {
      [CommissionBasis.COLLECTED]: 0,
      [CommissionBasis.INVOICED]: 0,
    };
    for (const item of items) totals[item.basis] += item.amount;

    const grouped = new Map<string, CommissionStatementLine>();
    for (const item of items) {
      const rule = CommissionsService.pickRule(
        rules,
        salesRepId,
        item.productCategoryId,
        item.basis,
        totals[item.basis],
      );
      const rate = rule ? Number(rule.rate) : 0;
      const key = `${item.invoiceId}|${item.productCategoryId}|${item.basis}|${rule?.id ?? ''}`;
      const line =
        grouped.get(key) ??
        ({
          invoiceId: item.invoiceId,
          invoiceNumber: item.invoiceNumber,
          productCategoryId: item.productCategoryId,
          basis: item.basis,
          baseAmount: 0,
          ruleId: rule?.id ?? null,
          rate,
          commission: 0,
        } as CommissionStatementLine);
      line.baseAmount += item.amount;
      grouped.set(key, line);
    }
    const lines = [...grouped.values()].map((l) => ({
      ...l,
      baseAmount: round(l.baseAmount, 4),
      commission: round((l.baseAmount * l.rate) / 100, 4),
    }));
    return {
      lines: lines.filter((l) => l.baseAmount !== 0),
      collected: round(totals[CommissionBasis.COLLECTED], 4),
      invoiced: round(totals[CommissionBasis.INVOICED], 4),
      commission: round(
        lines.reduce((s, l) => s + l.commission, 0),
        4,
      ),
    };
  }

  async compute(tenantId: string, dto: CommissionPeriodDto): Promise<CommissionComputation> {
    if (dto.periodFrom > dto.periodTo) {
      throw new BadRequestException('periodFrom must be before periodTo');
    }
    await this.findRep(tenantId, dto.salesRepId);
    const rules = (await this.ruleRepo.find({ where: { tenantId, isActive: true } })).filter(
      (r) => !r.salesRepId || r.salesRepId === dto.salesRepId,
    );
    const bases = new Set(rules.map((r) => r.basis));
    const items: CommissionBaseItem[] = [];

    // Invoiced basis: posted invoices minus credit notes of the rep in the period
    if (bases.has(CommissionBasis.INVOICED)) {
      const invoices = await this.invoiceRepo.find({
        where: {
          tenantId,
          salesRepId: dto.salesRepId,
          date: Between(dto.periodFrom, dto.periodTo),
          status: Not(In([SalesInvoiceStatus.DRAFT, SalesInvoiceStatus.CANCELLED])),
        },
        relations: ['lines'],
      });
      const inPeriod = invoices;
      const categories = await this.productCategories(tenantId, inPeriod);
      for (const invoice of inPeriod) {
        const sign = invoice.moveType === SalesInvoiceType.CREDIT_NOTE ? -1 : 1;
        for (const line of invoice.lines) {
          items.push({
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            productCategoryId: categories.get(line.productId) ?? null,
            basis: CommissionBasis.INVOICED,
            amount: sign * Number(line.lineTotal),
          });
        }
      }
    }

    // Collected basis: payments allocated to the rep's invoices, dated in the period
    if (bases.has(CommissionBasis.COLLECTED)) {
      const collected: { invoice_id: string; amount: string }[] = await this.invoiceRepo.query(
        `SELECT a.invoice_id, SUM(a.amount) AS amount
           FROM payment_allocations a
           JOIN payments p ON p.id = a.payment_id
           JOIN sales_invoices i ON i.id = a.invoice_id
          WHERE p.tenant_id = $1 AND p.status = 'posted'
            AND p.date BETWEEN $2 AND $3
            AND a.invoice_type = 'sales_invoice'
            AND i.tenant_id = $1 AND i.sales_rep_id = $4 AND i.move_type = 'invoice'
          GROUP BY a.invoice_id`,
        [tenantId, dto.periodFrom, dto.periodTo, dto.salesRepId],
      );
      if (collected.length) {
        const invoices = await this.invoiceRepo.find({
          where: { tenantId, id: In(collected.map((c) => c.invoice_id)) },
          relations: ['lines'],
        });
        const byId = new Map(invoices.map((i) => [i.id, i]));
        const categories = await this.productCategories(tenantId, invoices);
        for (const row of collected) {
          const invoice = byId.get(row.invoice_id);
          if (!invoice || !(Number(invoice.totalAmount) > 0)) continue;
          // Only the untaxed share of the collection earns commission.
          const untaxed =
            Number(row.amount) * (Number(invoice.subtotal) / Number(invoice.totalAmount));
          const subtotal = Number(invoice.subtotal);
          for (const line of invoice.lines) {
            const share = subtotal > 0 ? Number(line.lineTotal) / subtotal : 0;
            items.push({
              invoiceId: invoice.id,
              invoiceNumber: invoice.invoiceNumber,
              productCategoryId: categories.get(line.productId) ?? null,
              basis: CommissionBasis.COLLECTED,
              amount: untaxed * share,
            });
          }
        }
      }
    }

    const result = CommissionsService.computeFromItems(rules, dto.salesRepId, items);
    return {
      salesRepId: dto.salesRepId,
      periodFrom: dto.periodFrom,
      periodTo: dto.periodTo,
      collectedAmount: result.collected,
      invoicedAmount: result.invoiced,
      commissionAmount: result.commission,
      lines: result.lines,
    };
  }

  // -------------------------------------------------------- statements

  async createStatement(
    tenantId: string,
    userId: string,
    dto: CommissionPeriodDto,
  ): Promise<CommissionStatement> {
    const overlap = await this.statementRepo.findOne({
      where: {
        tenantId,
        salesRepId: dto.salesRepId,
        status: Not(CommissionStatementStatus.CANCELLED),
        periodFrom: LessThanOrEqual(dto.periodTo),
        periodTo: MoreThanOrEqual(dto.periodFrom),
      },
    });
    if (overlap) {
      throw new ConflictException(
        `Statement ${overlap.statementNumber} already covers part of this period`,
      );
    }
    const computed = await this.compute(tenantId, dto);
    return this.statementRepo.save(
      this.statementRepo.create({
        tenantId,
        statementNumber: await this.sequenceService.next(tenantId, 'commission_statement', 'COMM'),
        salesRepId: dto.salesRepId,
        periodFrom: dto.periodFrom,
        periodTo: dto.periodTo,
        collectedAmount: computed.collectedAmount,
        invoicedAmount: computed.invoicedAmount,
        commissionAmount: computed.commissionAmount,
        lines: computed.lines,
        status: CommissionStatementStatus.DRAFT,
        createdBy: userId,
      }),
    );
  }

  findStatements(tenantId: string, salesRepId?: string): Promise<CommissionStatement[]> {
    const where: Record<string, unknown> = { tenantId };
    if (salesRepId) where.salesRepId = salesRepId;
    return this.statementRepo.find({ where, order: { periodFrom: 'DESC' } });
  }

  async findStatement(tenantId: string, id: string): Promise<CommissionStatement> {
    const statement = await this.statementRepo.findOne({ where: { id, tenantId } });
    if (!statement) throw new NotFoundException('Commission statement not found');
    return statement;
  }

  /** Accrues the commission: Dr commission expense / Cr commission payable. */
  async postStatement(
    tenantId: string,
    userId: string,
    id: string,
    dto: PostCommissionDto = {},
  ): Promise<CommissionStatement> {
    const statement = await this.findStatement(tenantId, id);
    if (statement.status !== CommissionStatementStatus.DRAFT) {
      throw new ConflictException('Only draft statements can be posted');
    }
    const amount = round(Number(statement.commissionAmount), 4);
    const date = dto.date || statement.periodTo;
    if (amount > 0) {
      await this.autoPosting.preflight(tenantId, date, [
        'commissionExpenseAccountId',
        'commissionPayableAccountId',
      ]);
      const rep = await this.findRep(tenantId, statement.salesRepId);
      await this.autoPosting.post({
        tenantId,
        userId,
        journalType: JournalType.GENERAL,
        date,
        description: `Commission ${statement.statementNumber} - ${rep.name} (${statement.periodFrom} / ${statement.periodTo})`,
        sourceType: 'commission_statement',
        sourceId: statement.id,
        buildLines: (_s, account) => [
          { accountId: account('commissionExpenseAccountId'), debit: amount },
          { accountId: account('commissionPayableAccountId'), credit: amount },
        ],
      });
    }
    statement.status = CommissionStatementStatus.POSTED;
    statement.postedAt = new Date();
    return this.statementRepo.save(statement);
  }

  async cancelStatement(tenantId: string, userId: string, id: string): Promise<CommissionStatement> {
    const statement = await this.findStatement(tenantId, id);
    if (statement.status === CommissionStatementStatus.CANCELLED) {
      throw new ConflictException('Statement is already cancelled');
    }
    if (statement.status === CommissionStatementStatus.POSTED) {
      await this.autoPosting.reverseSource(tenantId, userId, 'commission_statement', statement.id);
    }
    statement.status = CommissionStatementStatus.CANCELLED;
    return this.statementRepo.save(statement);
  }

  private async productCategories(
    tenantId: string,
    invoices: SalesInvoice[],
  ): Promise<Map<string, string | null>> {
    const ids = [...new Set(invoices.flatMap((i) => (i.lines ?? []).map((l) => l.productId)))];
    if (ids.length === 0) return new Map();
    const products = await this.productRepo.find({ where: { tenantId, id: In(ids) } });
    return new Map(products.map((p) => [p.id, p.categoryId ?? null]));
  }

  /**
   * Commission vs sales per sales representative for a period: untaxed sales
   * in base currency (posted invoices net of credit notes, POS sales net of
   * refunds), commission accrued by posted statements whose period lies
   * within the range, and the effective commission rate. Documents without a
   * rep are reported on an "unassigned" row.
   */
  async repPerformance(tenantId: string, q: { from?: string; to?: string; salesRepId?: string }) {
    const params: unknown[] = [tenantId];
    const add = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    const inv = [`tenant_id = $1`, `status NOT IN ('draft', 'cancelled')`];
    const pos = [`tenant_id = $1`, `status IN ('completed', 'refunded')`];
    const st = [`tenant_id = $1`, `status = 'posted'`];
    if (q.from) {
      const p = add(q.from);
      inv.push(`date >= ${p}`);
      pos.push(`created_at::date >= ${p}`);
      st.push(`period_from >= ${p}`);
    }
    if (q.to) {
      const p = add(q.to);
      inv.push(`date <= ${p}`);
      pos.push(`created_at::date <= ${p}`);
      st.push(`period_to <= ${p}`);
    }
    if (q.salesRepId) {
      const p = add(q.salesRepId);
      inv.push(`sales_rep_id = ${p}`);
      pos.push(`sales_rep_id = ${p}`);
      st.push(`sales_rep_id = ${p}`);
    }
    const invoiced: any[] = await this.repRepo.query(
      `SELECT sales_rep_id AS "repId",
              SUM(CASE WHEN move_type = 'credit_note' THEN -1 ELSE 1 END * subtotal * COALESCE(exchange_rate, 1)) AS amount,
              COUNT(*) FILTER (WHERE move_type <> 'credit_note') AS documents
         FROM sales_invoices WHERE ${inv.join(' AND ')} GROUP BY sales_rep_id`,
      params,
    );
    const posSales: any[] = await this.repRepo.query(
      `SELECT sales_rep_id AS "repId", SUM(subtotal) AS amount,
              COUNT(*) FILTER (WHERE refunded_order_id IS NULL) AS documents
         FROM pos_orders WHERE ${pos.join(' AND ')} GROUP BY sales_rep_id`,
      params,
    );
    const commissions: any[] = await this.repRepo.query(
      `SELECT sales_rep_id AS "repId", SUM(commission_amount) AS commission,
              SUM(collected_amount) AS collected, COUNT(*) AS statements
         FROM commission_statements WHERE ${st.join(' AND ')} GROUP BY sales_rep_id`,
      params,
    );
    const reps = await this.repRepo.find({ where: { tenantId } });
    const rows = new Map<string, any>();
    const row = (repId: string | null) => {
      const key = repId ?? '';
      if (!rows.has(key)) {
        const rep = reps.find((r) => r.id === repId);
        rows.set(key, {
          salesRepId: repId,
          code: rep?.code ?? null,
          name: rep?.name ?? (repId ? repId : 'Unassigned'),
          invoicedSales: 0,
          posSales: 0,
          totalSales: 0,
          documents: 0,
          collected: 0,
          commission: 0,
          statements: 0,
          commissionRate: null as number | null,
        });
      }
      return rows.get(key);
    };
    for (const r of invoiced) {
      const x = row(r.repId);
      x.invoicedSales = round(Number(r.amount || 0), 4);
      x.documents += Number(r.documents || 0);
    }
    for (const r of posSales) {
      const x = row(r.repId);
      x.posSales = round(Number(r.amount || 0), 4);
      x.documents += Number(r.documents || 0);
    }
    for (const r of commissions) {
      const x = row(r.repId);
      x.commission = round(Number(r.commission || 0), 4);
      x.collected = round(Number(r.collected || 0), 4);
      x.statements = Number(r.statements || 0);
    }
    const list = [...rows.values()].map((x) => {
      x.totalSales = round(x.invoicedSales + x.posSales, 4);
      x.commissionRate = x.totalSales ? round((x.commission / x.totalSales) * 100, 2) : null;
      return x;
    });
    list.sort((a, b) => b.totalSales - a.totalSales);
    const sum = (k: string) => round(list.reduce((s, x) => s + Number(x[k] || 0), 0), 4);
    const totals = {
      invoicedSales: sum('invoicedSales'),
      posSales: sum('posSales'),
      totalSales: sum('totalSales'),
      collected: sum('collected'),
      commission: sum('commission'),
    };
    return {
      from: q.from ?? null,
      to: q.to ?? null,
      rows: list,
      totals: {
        ...totals,
        commissionRate: totals.totalSales ? round((totals.commission / totals.totalSales) * 100, 2) : null,
      },
    };
  }
}
