import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Customer } from '@modules/sales/entities/customer.entity';
import { Supplier } from '@modules/purchasing/entities/supplier.entity';
import { Account } from '@modules/accounting/entities/account.entity';
import { AutoPostingService, SettingsAccountKey } from '@modules/accounting/services/auto-posting.service';
import { AccountingSettingsService } from '@modules/accounting/services/accounting-settings.service';
import { OpeningBalancesService } from '@modules/accounting/services/opening-balances.service';
import { round } from '@shared/utils/document-totals.util';
import { ImportEntity } from '../entities/import-job.entity';
import type { ColumnSpec, ParsedRow } from '../utils/spreadsheet.util';
import {
  ImportContext,
  Importer,
  IssueList,
  PlannedRow,
  ValidationOutcome,
  has,
  keyOf,
  v,
} from './importer.types';
import { OffsetAccount, openingDate, resolveOffsetAccount } from './opening.helpers';

const balanceColumns = (party: 'customer' | 'supplier'): ColumnSpec[] => [
  {
    key: 'partnerCode',
    label: party === 'customer' ? { en: 'Customer code', ar: 'كود العميل' } : { en: 'Supplier code', ar: 'كود المورد' },
    required: true,
  },
  {
    key: 'amount',
    label: { en: 'Opening balance', ar: 'الرصيد الافتتاحي' },
    type: 'number',
    required: true,
    note:
      party === 'customer'
        ? { en: 'Positive = customer owes us; negative = credit balance', ar: 'موجب = مدين لنا؛ سالب = رصيد دائن للعميل' }
        : { en: 'Positive = we owe the supplier; negative = debit balance', ar: 'موجب = دائن (مستحق للمورد)؛ سالب = رصيد مدين' },
  },
  {
    key: 'date',
    label: { en: 'Document date', ar: 'تاريخ المستند' },
    type: 'date',
    note: { en: 'Default: the opening date of the request', ar: 'الافتراضي تاريخ الافتتاح المحدد في الطلب' },
  },
  {
    key: 'dueDate',
    label: { en: 'Due date', ar: 'تاريخ الاستحقاق' },
    type: 'date',
    note: { en: 'Default: date + payment terms', ar: 'الافتراضي التاريخ + مدة السداد' },
  },
  { key: 'reference', label: { en: 'Reference', ar: 'المرجع' } },
  { key: 'notes', label: { en: 'Notes', ar: 'ملاحظات' }, width: 30 },
];

interface BalancePlan {
  partnerId: string;
  partnerCode: string;
  amount: number;
  date: string;
  dueDate?: string;
  reference?: string;
}

interface BalanceOutcomeExtra {
  offset: OffsetAccount;
}

/**
 * Opening receivable / payable balances, posted through the accounting
 * opening-balances API: each row becomes an open opening document (OB-INV /
 * OB-BILL, or a credit note / refund for a negative balance) posted directly
 * against the opening-equity offset account (Dr receivable / Cr equity for
 * customers, Dr equity / Cr payable for suppliers). The documents can then be
 * paid, allocated and aged like any invoice or bill. They do not emit the
 * "invoice posted" event, so they are never sent to ETA/ZATCA, and they are
 * not subject to bill approval rules.
 */
abstract class OpeningBalancesImporter implements Importer<BalancePlan> {
  abstract readonly entity: ImportEntity;
  abstract readonly title: { en: string; ar: string };
  abstract readonly columns: ColumnSpec[];
  protected abstract readonly party: 'customer' | 'supplier';

  constructor(
    protected readonly dataSource: DataSource,
    protected readonly accountRepo: Repository<Account>,
    protected readonly autoPosting: AutoPostingService,
    protected readonly accountingSettings: AccountingSettingsService,
    protected readonly openingBalances: OpeningBalancesService,
  ) {}

  protected abstract partners(tenantId: string): Promise<(Customer | Supplier)[]>;
  protected abstract preflightKey(): SettingsAccountKey;

  /** Party-specific checks; none by default. */
  protected async extraChecks(
    _ctx: ImportContext,
    _planned: PlannedRow<BalancePlan>[],
    _issues: IssueList,
  ): Promise<void> {}

  async validate(ctx: ImportContext, rows: ParsedRow[]): Promise<ValidationOutcome<BalancePlan>> {
    const { tenantId } = ctx;
    const issues = new IssueList();
    const date = openingDate(ctx);
    const settings = await this.accountingSettings.find(tenantId);
    if (!settings) {
      issues.error(0, 'accounting_not_configured', 'Configure accounting (run the setup wizard) before importing opening balances');
    }
    const offset = await resolveOffsetAccount(ctx, this.accountRepo, settings, 'retainedEarningsAccountId', issues);
    const partners = new Map((await this.partners(tenantId)).map((p) => [keyOf(p.code), p]));
    const dates = new Set<string>();

    const planned: PlannedRow<BalancePlan>[] = [];
    for (const row of rows) {
      const n = row.rowNumber;
      if (!has(row, 'partnerCode') || !has(row, 'amount')) continue;
      const partner = partners.get(keyOf(v(row, 'partnerCode')));
      if (!partner) {
        issues.error(n, 'not_found', `${this.party === 'customer' ? 'Customer' : 'Supplier'} ${v(row, 'partnerCode')} not found`, 'partnerCode');
        continue;
      }
      const amount = round(Number(v(row, 'amount')), 2);
      if (amount === 0) {
        issues.warning(n, 'zero_amount', 'Zero balance is skipped', 'amount');
        planned.push({ row, action: 'skip', data: { partnerId: partner.id, partnerCode: partner.code, amount, date } });
        continue;
      }
      const docDate = has(row, 'date') ? String(v(row, 'date')) : date;
      const dueDate = has(row, 'dueDate') ? String(v(row, 'dueDate')) : undefined;
      if (dueDate && dueDate < docDate) issues.error(n, 'invalid_date', 'Due date is before the document date', 'dueDate');
      dates.add(docDate);
      const reference = has(row, 'reference') ? String(v(row, 'reference')) : undefined;
      const notes = has(row, 'notes') ? String(v(row, 'notes')) : undefined;
      planned.push({
        row,
        action: 'create',
        data: {
          partnerId: partner.id,
          partnerCode: partner.code,
          amount,
          date: docDate,
          dueDate,
          reference: [reference, notes].filter(Boolean).join(' - ') || undefined,
        },
      });
    }

    if (settings) {
      for (const d of dates) {
        try {
          await this.autoPosting.preflight(tenantId, d, [this.preflightKey()]);
        } catch (err) {
          issues.error(0, 'posting_blocked', `${d}: ${(err as Error).message}`);
        }
      }
    }
    await this.extraChecks(ctx, planned, issues);

    const positive = round(planned.filter((p) => p.action === 'create' && p.data.amount > 0).reduce((s, p) => s + p.data.amount, 0), 2);
    const negative = round(planned.filter((p) => p.action === 'create' && p.data.amount < 0).reduce((s, p) => s - p.data.amount, 0), 2);
    const outcome: ValidationOutcome<BalancePlan> & BalanceOutcomeExtra = {
      planned,
      issues: issues.items,
      summary: { date, positive, negative, net: round(positive - negative, 2), offsetAccountCode: offset.code ?? null },
      offset,
    };
    return outcome;
  }

  async commit(ctx: ImportContext, outcome: ValidationOutcome<BalancePlan>): Promise<Record<string, unknown>> {
    const { tenantId, userId } = ctx;
    const { offset } = outcome as ValidationOutcome<BalancePlan> & BalanceOutcomeExtra;
    const items = outcome.planned.filter((p) => p.action === 'create');
    if (!items.length) return { documents: [] };

    // The opening API takes one date per call: post each document date separately.
    const byDate = new Map<string, BalancePlan[]>();
    for (const { data } of items) byDate.set(data.date, [...(byDate.get(data.date) ?? []), data]);

    const documents: string[] = [];
    for (const [date, plans] of byDate) {
      const results = await this.openingBalances.postPartners(tenantId, userId, {
        date,
        equityAccountId: offset?.accountId ?? undefined,
        documents: plans.map((p) => ({
          partnerType: this.party,
          partnerId: p.partnerId,
          amount: p.amount,
          dueDate: p.dueDate,
          reference: p.reference,
        })),
      });
      documents.push(...results.map((r) => r.documentNumber ?? r.id));
    }
    const positive = round(items.filter((i) => i.data.amount > 0).reduce((s, i) => s + i.data.amount, 0), 2);
    const negative = round(items.filter((i) => i.data.amount < 0).reduce((s, i) => s - i.data.amount, 0), 2);
    return { documents, positive, negative };
  }
}

@Injectable()
export class OpeningCustomerBalancesImporter extends OpeningBalancesImporter {
  readonly entity = ImportEntity.OPENING_CUSTOMER_BALANCES;
  readonly title = { en: 'Opening customer balances', ar: 'أرصدة العملاء الافتتاحية' };
  readonly columns = balanceColumns('customer');
  protected readonly party = 'customer' as const;

  constructor(
    dataSource: DataSource,
    @InjectRepository(Account) accountRepo: Repository<Account>,
    @InjectRepository(Customer) private readonly customerRepo: Repository<Customer>,
    autoPosting: AutoPostingService,
    accountingSettings: AccountingSettingsService,
    openingBalances: OpeningBalancesService,
  ) {
    super(dataSource, accountRepo, autoPosting, accountingSettings, openingBalances);
  }

  protected partners(tenantId: string) {
    return this.customerRepo.find({ where: { tenantId } });
  }

  protected preflightKey(): SettingsAccountKey {
    return 'receivableAccountId';
  }
}

@Injectable()
export class OpeningSupplierBalancesImporter extends OpeningBalancesImporter {
  readonly entity = ImportEntity.OPENING_SUPPLIER_BALANCES;
  readonly title = { en: 'Opening supplier balances', ar: 'أرصدة الموردين الافتتاحية' };
  readonly columns = balanceColumns('supplier');
  protected readonly party = 'supplier' as const;

  constructor(
    dataSource: DataSource,
    @InjectRepository(Account) accountRepo: Repository<Account>,
    @InjectRepository(Supplier) private readonly supplierRepo: Repository<Supplier>,
    autoPosting: AutoPostingService,
    accountingSettings: AccountingSettingsService,
    openingBalances: OpeningBalancesService,
  ) {
    super(dataSource, accountRepo, autoPosting, accountingSettings, openingBalances);
  }

  protected partners(tenantId: string) {
    return this.supplierRepo.find({ where: { tenantId } });
  }

  protected preflightKey(): SettingsAccountKey {
    return 'payableAccountId';
  }

  /** Vendor references must stay unique per supplier (bills). */
  protected async extraChecks(
    ctx: ImportContext,
    planned: PlannedRow<BalancePlan>[],
    issues: IssueList,
  ): Promise<void> {
    const refs: { supplier_id: string; supplier_reference: string }[] = await this.dataSource.query(
      `SELECT supplier_id, supplier_reference FROM purchase_invoices
        WHERE tenant_id = $1 AND supplier_reference IS NOT NULL AND status <> 'cancelled' AND move_type = 'bill'`,
      [ctx.tenantId],
    );
    const used = new Set(refs.map((r) => `${r.supplier_id}:${keyOf(r.supplier_reference)}`));
    for (const p of planned) {
      if (p.action !== 'create' || !p.data.reference || p.data.amount < 0) continue;
      const key = `${p.data.partnerId}:${keyOf(p.data.reference)}`;
      if (used.has(key)) {
        issues.error(p.row.rowNumber, 'duplicate_reference', `Reference ${p.data.reference} is already used for this supplier`, 'reference');
      }
      used.add(key);
    }
  }
}
