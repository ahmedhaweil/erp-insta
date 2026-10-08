import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Customer } from '@modules/sales/entities/customer.entity';
import { Supplier } from '@modules/purchasing/entities/supplier.entity';
import { SalesInvoiceType } from '@modules/sales/entities/sales-invoice.entity';
import { PurchaseInvoiceType } from '@modules/purchasing/entities/purchase-invoice.entity';
import { SalesInvoicesService } from '@modules/sales/services/sales-invoices.service';
import { PurchaseInvoicesService } from '@modules/purchasing/services/purchase-invoices.service';
import { Product, ProductType } from '@modules/inventory/entities/product.entity';
import { Category } from '@modules/inventory/entities/category.entity';
import { Unit } from '@modules/inventory/entities/unit.entity';
import { ProductsService } from '@modules/inventory/services/products.service';
import { Account } from '@modules/accounting/entities/account.entity';
import { JournalType } from '@modules/accounting/entities/journal.entity';
import { AutoPostingService, PostingLine, SettingsAccountKey } from '@modules/accounting/services/auto-posting.service';
import { AccountingSettingsService } from '@modules/accounting/services/accounting-settings.service';
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

/** Hidden service product carried by opening invoices / bills. */
export const OPENING_PRODUCT_CODE = 'OPENING-BALANCE';

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
  notes?: string;
}

interface BalanceOutcomeExtra {
  offset: OffsetAccount;
}

/**
 * Opening receivable / payable balances. There is no dedicated opening-balance
 * API, so each row becomes an open document created and posted through the
 * existing services (so it can be paid, allocated and aged):
 *  - customers: a sales invoice (or a credit note for a negative balance),
 *  - suppliers: a vendor bill (or a vendor refund for a negative balance),
 * each with one zero-tax line on the hidden service product OPENING-BALANCE.
 * Their postings hit sales / purchase accounts, so one correcting journal
 * entry per import moves those amounts to the offset (opening-equity) account:
 * net effect Dr receivable / Cr opening equity (customers) and
 * Dr opening equity / Cr payable (suppliers).
 */
abstract class OpeningBalancesImporter implements Importer<BalancePlan> {
  abstract readonly entity: ImportEntity;
  abstract readonly title: { en: string; ar: string };
  abstract readonly columns: ColumnSpec[];
  protected abstract readonly party: 'customer' | 'supplier';

  constructor(
    protected readonly dataSource: DataSource,
    protected readonly productRepo: Repository<Product>,
    protected readonly categoryRepo: Repository<Category>,
    protected readonly unitRepo: Repository<Unit>,
    protected readonly accountRepo: Repository<Account>,
    protected readonly productsService: ProductsService,
    protected readonly autoPosting: AutoPostingService,
    protected readonly accountingSettings: AccountingSettingsService,
  ) {}

  protected abstract partners(tenantId: string): Promise<(Customer | Supplier)[]>;
  protected abstract preflightKeys(): SettingsAccountKey[];
  protected abstract extraChecks(
    ctx: ImportContext,
    planned: PlannedRow<BalancePlan>[],
    partners: Map<string, Customer | Supplier>,
    issues: IssueList,
  ): Promise<void>;
  protected abstract createDocument(ctx: ImportContext, productId: string, plan: BalancePlan): Promise<string>;
  protected abstract correctionLines(
    settings: any,
    account: (key: SettingsAccountKey) => string,
    offsetId: string,
    positive: number,
    negative: number,
  ): PostingLine[];

  async validate(ctx: ImportContext, rows: ParsedRow[]): Promise<ValidationOutcome<BalancePlan>> {
    const { tenantId } = ctx;
    const issues = new IssueList();
    const date = openingDate(ctx);
    const settings = await this.accountingSettings.find(tenantId);
    const offset = await resolveOffsetAccount(ctx, this.accountRepo, settings, 'retainedEarningsAccountId', issues);
    const partners = new Map((await this.partners(tenantId)).map((p) => [keyOf(p.code), p]));
    const byId = new Map([...partners.values()].map((p) => [p.id, p]));
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
      planned.push({
        row,
        action: 'create',
        data: {
          partnerId: partner.id,
          partnerCode: partner.code,
          amount,
          date: docDate,
          dueDate,
          reference: has(row, 'reference') ? String(v(row, 'reference')) : undefined,
          notes: has(row, 'notes') ? String(v(row, 'notes')) : undefined,
        },
      });
    }

    if (settings) {
      for (const d of dates) {
        try {
          await this.autoPosting.preflight(tenantId, d, this.preflightKeys());
        } catch (err) {
          issues.error(0, 'posting_blocked', `${d}: ${(err as Error).message}`);
        }
      }
    }
    await this.extraChecks(ctx, planned, byId as any, issues);

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
    const { tenantId, userId, jobId } = ctx;
    const { offset } = outcome as ValidationOutcome<BalancePlan> & BalanceOutcomeExtra;
    const items = outcome.planned.filter((p) => p.action === 'create');
    if (!items.length) return { documents: [] };
    const productId = await this.openingProductId(tenantId);
    const documents: string[] = [];
    for (const item of items) documents.push(await this.createDocument(ctx, productId, item.data));

    const positive = round(items.filter((i) => i.data.amount > 0).reduce((s, i) => s + i.data.amount, 0), 2);
    const negative = round(items.filter((i) => i.data.amount < 0).reduce((s, i) => s - i.data.amount, 0), 2);
    let journalEntryId: string | null = null;
    if (offset?.accountId) {
      const date = openingDate(ctx);
      const entry = await this.autoPosting.post({
        tenantId,
        userId,
        journalType: JournalType.GENERAL,
        date,
        description: `Opening ${this.party} balances import - transfer to opening equity`,
        sourceType: 'data_import',
        sourceId: jobId,
        buildLines: (s, account) => this.correctionLines(s, account, offset.accountId!, positive, negative),
      });
      journalEntryId = entry?.id ?? null;
    }
    return { documents, positive, negative, journalEntryId };
  }

  /** Finds or creates the inactive service product used on opening documents. */
  protected async openingProductId(tenantId: string): Promise<string> {
    const existing = await this.productRepo.findOne({ where: { tenantId, code: OPENING_PRODUCT_CODE } });
    if (existing) return existing.id;
    const categoryName = 'أرصدة افتتاحية';
    const category =
      (await this.categoryRepo.findOne({ where: { tenantId, nameAr: categoryName } })) ??
      (await this.categoryRepo.save(
        this.categoryRepo.create({ tenantId, nameAr: categoryName, nameEn: 'Opening balances', level: 0 }),
      ));
    const unit =
      (await this.unitRepo.findOne({ where: { tenantId }, order: { createdAt: 'ASC' } })) ??
      (await this.unitRepo.save(
        this.unitRepo.create({ tenantId, nameAr: 'وحدة', nameEn: 'Unit', symbol: 'unit', conversionFactor: 1 }),
      ));
    const product = await this.productsService.create(tenantId, {
      code: OPENING_PRODUCT_CODE,
      nameAr: 'رصيد افتتاحي',
      nameEn: 'Opening balance',
      type: ProductType.SERVICE,
      categoryId: category.id,
      unitId: unit.id,
      isActive: false,
      salesTaxRate: 0,
      purchaseTaxRate: 0,
    });
    return product.id;
  }

  protected line(productId: string, plan: BalancePlan) {
    return {
      productId,
      quantity: 1,
      unitPrice: Math.abs(plan.amount),
      discount: 0,
      taxRate: 0,
      description: `Opening balance${plan.reference ? ` ${plan.reference}` : ''}`,
    };
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
    @InjectRepository(Product) productRepo: Repository<Product>,
    @InjectRepository(Category) categoryRepo: Repository<Category>,
    @InjectRepository(Unit) unitRepo: Repository<Unit>,
    @InjectRepository(Account) accountRepo: Repository<Account>,
    @InjectRepository(Customer) private readonly customerRepo: Repository<Customer>,
    productsService: ProductsService,
    autoPosting: AutoPostingService,
    accountingSettings: AccountingSettingsService,
    private readonly invoices: SalesInvoicesService,
  ) {
    super(dataSource, productRepo, categoryRepo, unitRepo, accountRepo, productsService, autoPosting, accountingSettings);
  }

  protected partners(tenantId: string) {
    return this.customerRepo.find({ where: { tenantId } });
  }

  protected preflightKeys(): SettingsAccountKey[] {
    return ['receivableAccountId', 'salesAccountId', 'outputTaxAccountId'];
  }

  protected async extraChecks(
    ctx: ImportContext,
    planned: PlannedRow<BalancePlan>[],
    partners: Map<string, Customer>,
    issues: IssueList,
  ): Promise<void> {
    // Posting an invoice is refused above the customer's credit limit.
    const added = new Map<string, number>();
    for (const p of planned) {
      if (p.action !== 'create') continue;
      const customer = partners.get(p.data.partnerId)!;
      const balance = round(Number(customer.balance) + (added.get(customer.id) ?? 0) + p.data.amount, 2);
      added.set(customer.id, round((added.get(customer.id) ?? 0) + p.data.amount, 2));
      if (p.data.amount > 0 && Number(customer.creditLimit) > 0 && balance > Number(customer.creditLimit)) {
        issues.error(
          p.row.rowNumber,
          'credit_limit',
          `Balance ${balance} exceeds the credit limit ${Number(customer.creditLimit)} of ${customer.code}; raise the limit first`,
          'amount',
        );
      }
    }
    // Posted invoices are submitted automatically to the tax authority when enabled.
    const rows: { auto: boolean }[] = await this.dataSource.query(
      `SELECT (is_enabled AND auto_submit) AS auto FROM compliance_settings WHERE tenant_id = $1`,
      [ctx.tenantId],
    );
    if (rows[0]?.auto && planned.some((p) => p.action === 'create' && p.data.amount > 0)) {
      issues.error(
        0,
        'einvoice_auto_submit',
        'Automatic e-invoice submission is enabled: disable it during the import so opening invoices are not sent to the tax authority',
      );
    }
  }

  protected async createDocument(ctx: ImportContext, productId: string, plan: BalancePlan): Promise<string> {
    const invoice = await this.invoices.create(
      ctx.tenantId,
      ctx.userId,
      {
        customerId: plan.partnerId,
        date: plan.date,
        dueDate: plan.dueDate,
        notes: plan.notes ?? `Opening balance (import ${ctx.jobId})`,
        lines: [this.line(productId, plan)],
      },
      plan.amount < 0 ? { moveType: SalesInvoiceType.CREDIT_NOTE } : {},
      { skipPriceChecks: true },
    );
    await this.invoices.post(ctx.tenantId, ctx.userId, invoice.id);
    return invoice.invoiceNumber;
  }

  protected correctionLines(
    s: any,
    account: (key: SettingsAccountKey) => string,
    offsetId: string,
    positive: number,
    negative: number,
  ): PostingLine[] {
    return [
      // Invoices credited sales: move to opening equity
      { accountId: account('salesAccountId'), debit: positive },
      { accountId: offsetId, credit: positive },
      // Credit notes debited sales returns (or sales)
      { accountId: offsetId, debit: negative },
      { accountId: s.salesReturnAccountId || account('salesAccountId'), credit: negative },
    ];
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
    @InjectRepository(Product) productRepo: Repository<Product>,
    @InjectRepository(Category) categoryRepo: Repository<Category>,
    @InjectRepository(Unit) unitRepo: Repository<Unit>,
    @InjectRepository(Account) accountRepo: Repository<Account>,
    @InjectRepository(Supplier) private readonly supplierRepo: Repository<Supplier>,
    productsService: ProductsService,
    autoPosting: AutoPostingService,
    accountingSettings: AccountingSettingsService,
    private readonly bills: PurchaseInvoicesService,
  ) {
    super(dataSource, productRepo, categoryRepo, unitRepo, accountRepo, productsService, autoPosting, accountingSettings);
  }

  protected partners(tenantId: string) {
    return this.supplierRepo.find({ where: { tenantId } });
  }

  protected preflightKeys(): SettingsAccountKey[] {
    return ['payableAccountId', 'purchaseAccountId', 'inputTaxAccountId'];
  }

  protected async extraChecks(
    ctx: ImportContext,
    planned: PlannedRow<BalancePlan>[],
    _partners: Map<string, Supplier>,
    issues: IssueList,
  ): Promise<void> {
    // Vendor references must be unique per supplier (bills).
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

  protected async createDocument(ctx: ImportContext, productId: string, plan: BalancePlan): Promise<string> {
    const refund = plan.amount < 0;
    const bill = await this.bills.create(
      ctx.tenantId,
      ctx.userId,
      {
        supplierId: plan.partnerId,
        date: plan.date,
        dueDate: plan.dueDate,
        supplierReference: refund ? undefined : plan.reference,
        notes: plan.notes ?? `Opening balance (import ${ctx.jobId})`,
        lines: [this.line(productId, plan)],
      },
      refund ? { moveType: PurchaseInvoiceType.REFUND } : {},
    );
    await this.bills.approve(ctx.tenantId, bill.id, ctx.userId);
    return bill.invoiceNumber;
  }

  protected correctionLines(
    s: any,
    account: (key: SettingsAccountKey) => string,
    offsetId: string,
    positive: number,
    negative: number,
  ): PostingLine[] {
    return [
      // Bills debited purchases: move to opening equity
      { accountId: offsetId, debit: positive },
      { accountId: account('purchaseAccountId'), credit: positive },
      // Refunds credited purchase returns (or purchases)
      { accountId: s.purchaseReturnAccountId || account('purchaseAccountId'), debit: negative },
      { accountId: offsetId, credit: negative },
    ];
  }
}
