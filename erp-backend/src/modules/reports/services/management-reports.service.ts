import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  SalesInvoice,
  SalesInvoiceStatus,
  SalesInvoiceType,
} from '@modules/sales/entities/sales-invoice.entity';
import {
  PurchaseInvoice,
  PurchaseInvoiceStatus,
  PurchaseInvoiceType,
} from '@modules/purchasing/entities/purchase-invoice.entity';
import { Budget } from '@modules/accounting/entities/budget.entity';
import { FiscalYear } from '@modules/accounting/entities/fiscal-year.entity';
import { Account, AccountType } from '@modules/accounting/entities/account.entity';
import { JournalLine } from '@modules/accounting/entities/journal-line.entity';
import { JournalEntryStatus } from '@modules/accounting/entities/journal-entry.entity';
import { residual, round, today } from '@shared/utils/document-totals.util';

const BUCKETS = ['current', '1-30', '31-60', '61-90', '90+'] as const;
type Bucket = (typeof BUCKETS)[number];

export interface AgedPartnerRow {
  partnerId: string;
  partnerName: string;
  buckets: Record<Bucket, number>;
  total: number;
}

function daysBetween(from: string, to: string): number {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function bucketFor(daysOverdue: number): Bucket {
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return '1-30';
  if (daysOverdue <= 60) return '31-60';
  if (daysOverdue <= 90) return '61-90';
  return '90+';
}

function emptyBuckets(): Record<Bucket, number> {
  return { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
}

@Injectable()
export class ManagementReportsService {
  constructor(
    @InjectRepository(SalesInvoice)
    private readonly salesInvoiceRepo: Repository<SalesInvoice>,
    @InjectRepository(PurchaseInvoice)
    private readonly purchaseInvoiceRepo: Repository<PurchaseInvoice>,
    @InjectRepository(Budget)
    private readonly budgetRepo: Repository<Budget>,
    @InjectRepository(FiscalYear)
    private readonly fiscalYearRepo: Repository<FiscalYear>,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    @InjectRepository(JournalLine)
    private readonly lineRepo: Repository<JournalLine>,
  ) {}

  /** Aged receivable: open customer invoices (minus open credit notes) by days overdue. */
  async getAgedReceivables(tenantId: string, asOf: string = today()) {
    const invoices = await this.salesInvoiceRepo.find({
      where: {
        tenantId,
        status: In([
          SalesInvoiceStatus.POSTED,
          SalesInvoiceStatus.SENT,
          SalesInvoiceStatus.PARTIAL,
          SalesInvoiceStatus.OVERDUE,
        ]),
      },
      relations: ['customer'],
    });
    return this.age(
      invoices
        .filter((i) => i.date <= asOf)
        .map((i) => ({
          partnerId: i.customerId,
          partnerName: i.customer?.nameEn || i.customer?.nameAr || '',
          dueDate: i.dueDate,
          amount:
            (i.moveType === SalesInvoiceType.CREDIT_NOTE ? -1 : 1) *
            residual(i.totalAmount, i.paidAmount),
        })),
      asOf,
    );
  }

  /** Aged payable: open vendor bills (minus open refunds) by days overdue. */
  async getAgedPayables(tenantId: string, asOf: string = today()) {
    const bills = await this.purchaseInvoiceRepo.find({
      where: {
        tenantId,
        status: In([
          PurchaseInvoiceStatus.APPROVED,
          PurchaseInvoiceStatus.PARTIAL,
          PurchaseInvoiceStatus.OVERDUE,
        ]),
      },
      relations: ['supplier'],
    });
    return this.age(
      bills
        .filter((b) => b.date <= asOf)
        .map((b) => ({
          partnerId: b.supplierId,
          partnerName: b.supplier?.nameEn || b.supplier?.nameAr || '',
          dueDate: b.dueDate,
          amount:
            (b.moveType === PurchaseInvoiceType.REFUND ? -1 : 1) *
            residual(b.totalAmount, b.paidAmount),
        })),
      asOf,
    );
  }

  /** Budget vs actual per account for a fiscal year (Odoo budget analysis). */
  async getBudgetVsActual(tenantId: string, fiscalYearId: string) {
    const year = await this.fiscalYearRepo.findOne({ where: { id: fiscalYearId, tenantId } });
    if (!year) return { fiscalYear: null, lines: [] };

    const budgets = await this.budgetRepo.find({ where: { tenantId, fiscalYearId } });
    if (budgets.length === 0) return { fiscalYear: year, lines: [] };

    const accountIds = [...new Set(budgets.map((b) => b.accountId))];
    const accounts = await this.accountRepo.find({ where: { tenantId, id: In(accountIds) } });
    const accountById = new Map(accounts.map((a) => [a.id, a]));

    const actuals: { accountId: string; costCenterId: string | null; balance: string }[] =
      await this.lineRepo
        .createQueryBuilder('line')
        .innerJoin('line.entry', 'entry')
        .select('line.accountId', 'accountId')
        .addSelect('line.costCenterId', 'costCenterId')
        .addSelect('SUM(line.debit) - SUM(line.credit)', 'balance')
        .where('entry.tenantId = :tenantId', { tenantId })
        .andWhere('entry.status = :status', { status: JournalEntryStatus.POSTED })
        .andWhere('entry.date BETWEEN :start AND :end', {
          start: year.startDate,
          end: year.endDate,
        })
        .andWhere("(entry.sourceType IS NULL OR entry.sourceType <> 'fiscal_year_closing')")
        .andWhere('line.accountId IN (:...accountIds)', { accountIds })
        .groupBy('line.accountId')
        .addGroupBy('line.costCenterId')
        .getRawMany();

    // Budget amounts are per period; annualise them for comparison
    const periodsPerYear = { monthly: 12, quarterly: 4, annual: 1 } as const;

    const lines = budgets.map((b) => {
      const account = accountById.get(b.accountId);
      const sign =
        account?.type === AccountType.REVENUE ||
        account?.type === AccountType.LIABILITY ||
        account?.type === AccountType.EQUITY
          ? -1
          : 1;
      const actual = round(
        sign *
          actuals
            .filter(
              (a) =>
                a.accountId === b.accountId &&
                (!b.costCenterId || a.costCenterId === b.costCenterId),
            )
            .reduce((sum, a) => sum + Number(a.balance), 0),
        4,
      );
      const planned = round(Number(b.amount) * (periodsPerYear[b.period] ?? 1), 4);
      return {
        budgetId: b.id,
        accountId: b.accountId,
        accountCode: account?.code,
        accountName: account?.nameEn || account?.nameAr,
        costCenterId: b.costCenterId,
        planned,
        actual,
        variance: round(planned - actual, 4),
        achievement: planned ? round((actual / planned) * 100, 2) : null,
      };
    });

    return { fiscalYear: year, lines };
  }

  private age(
    items: { partnerId: string; partnerName: string; dueDate: string; amount: number }[],
    asOf: string,
  ) {
    const rows = new Map<string, AgedPartnerRow>();
    const totals = emptyBuckets();

    for (const item of items) {
      if (!item.amount) continue;
      const bucket = bucketFor(daysBetween(item.dueDate, asOf));
      const row = rows.get(item.partnerId) ?? {
        partnerId: item.partnerId,
        partnerName: item.partnerName,
        buckets: emptyBuckets(),
        total: 0,
      };
      row.buckets[bucket] = round(row.buckets[bucket] + item.amount, 4);
      row.total = round(row.total + item.amount, 4);
      totals[bucket] = round(totals[bucket] + item.amount, 4);
      rows.set(item.partnerId, row);
    }

    const partners = [...rows.values()].sort((a, b) => b.total - a.total);
    return {
      asOf,
      partners,
      totals,
      total: round(
        partners.reduce((sum, p) => sum + p.total, 0),
        4,
      ),
    };
  }
}
