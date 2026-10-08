import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { OpeningBalance, OpeningBalanceKind } from '../entities/closing.entity';
import { Account } from '../entities/account.entity';
import { JournalType } from '../entities/journal.entity';
import { OpeningAccountsDto, OpeningPartnerDocumentDto, OpeningPartnersDto } from '../dto/accounting-depth.dto';
import { AccountingSettingsService } from './accounting-settings.service';
import { AutoPostingService } from './auto-posting.service';
import { JournalEntriesService } from './journal-entries.service';
import { SequenceService } from '@shared/services/sequence.service';
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
import { Customer } from '@modules/sales/entities/customer.entity';
import { Supplier } from '@modules/purchasing/entities/supplier.entity';
import { round } from '@shared/utils/document-totals.util';

export const OPENING_SOURCE = 'opening_balance';

/**
 * Balancing line of an opening entry: the difference between debits and
 * credits goes to the opening balance equity account.
 */
export function balanceOpening(
  lines: { accountId: string; debit?: number; credit?: number }[],
  equityAccountId: string,
): { accountId: string; debit: number; credit: number }[] {
  const out = lines.map((l) => ({
    ...l,
    accountId: l.accountId,
    debit: round(Number(l.debit || 0), 2),
    credit: round(Number(l.credit || 0), 2),
  }));
  for (const l of out) {
    if (l.debit < 0 || l.credit < 0) throw new BadRequestException('Amounts cannot be negative');
    if ((l.debit > 0) === (l.credit > 0)) {
      throw new BadRequestException('Each opening line needs either a debit or a credit');
    }
  }
  const diff = round(out.reduce((s, l) => s + l.debit - l.credit, 0), 2);
  if (diff > 0) out.push({ accountId: equityAccountId, debit: 0, credit: diff });
  if (diff < 0) out.push({ accountId: equityAccountId, debit: -diff, credit: 0 });
  return out;
}

/**
 * Opening balances: a GL opening entry for account balances, and opening
 * receivable/payable documents per partner. Partner openings are stored as
 * posted sales invoices / vendor bills (numbered OB-INV / OB-BILL, no lines,
 * subtotal 0 so they never count as revenue or expense) so they age and are
 * settled through the normal payments flow, and cancel like any invoice.
 */
@Injectable()
export class OpeningBalancesService {
  constructor(
    @InjectRepository(OpeningBalance)
    private readonly openingRepo: Repository<OpeningBalance>,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    @InjectRepository(SalesInvoice)
    private readonly salesInvoiceRepo: Repository<SalesInvoice>,
    @InjectRepository(PurchaseInvoice)
    private readonly purchaseInvoiceRepo: Repository<PurchaseInvoice>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    @InjectRepository(Supplier)
    private readonly supplierRepo: Repository<Supplier>,
    private readonly settingsService: AccountingSettingsService,
    private readonly autoPosting: AutoPostingService,
    private readonly journalEntries: JournalEntriesService,
    private readonly sequenceService: SequenceService,
  ) {}

  findAll(tenantId: string, kind?: OpeningBalanceKind): Promise<OpeningBalance[]> {
    const where: any = { tenantId };
    if (kind) where.kind = kind;
    return this.openingRepo.find({ where, order: { createdAt: 'DESC' } });
  }

  /** Posts the opening entry for account balances; the difference goes to equity. */
  async postAccounts(tenantId: string, userId: string, dto: OpeningAccountsDto) {
    const settings = await this.settingsService.find(tenantId);
    const equityAccountId = dto.equityAccountId ?? settings?.retainedEarningsAccountId;
    if (!equityAccountId) {
      throw new BadRequestException(
        'Choose an opening balance equity account (or configure retained earnings in the accounting settings)',
      );
    }
    if (!dto.allowControlAccounts && settings) {
      const control = [settings.receivableAccountId, settings.payableAccountId].filter(Boolean);
      const hit = dto.lines.find((l) => control.includes(l.accountId));
      if (hit) {
        throw new UnprocessableEntityException(
          'Receivable/payable control accounts are opened per partner (POST /accounting/opening-balances/partners) so the sub-ledgers match; set allowControlAccounts to override',
        );
      }
    }
    const ids = [...new Set([...dto.lines.map((l) => l.accountId), equityAccountId])];
    const found = await this.accountRepo.count({ where: { tenantId, id: In(ids) } });
    if (found !== ids.length) throw new NotFoundException('One or more accounts do not exist');

    const balanced = balanceOpening(dto.lines, equityAccountId);
    const byAccount = new Map(dto.lines.map((l) => [l.accountId, l]));
    const record = await this.openingRepo.save(
      this.openingRepo.create({
        tenantId,
        kind: OpeningBalanceKind.ACCOUNTS,
        date: dto.date,
        amount: round(balanced.reduce((s, l) => s + l.debit, 0), 2),
        equityAccountId,
        description: dto.description ?? 'Opening balances',
        createdBy: userId,
      }),
    );
    const journal = await this.autoPosting.resolveJournal(tenantId, JournalType.GENERAL);
    const entry = await this.journalEntries.createAndPost(
      tenantId,
      userId,
      {
        journalId: journal.id,
        date: dto.date,
        description: dto.description ?? 'Opening balances',
        lines: balanced.map((l) => ({
          accountId: l.accountId,
          debit: l.debit,
          credit: l.credit,
          description: byAccount.get(l.accountId)?.description ?? 'Opening balance',
          costCenterId: byAccount.get(l.accountId)?.costCenterId,
          branchId: byAccount.get(l.accountId)?.branchId,
        })),
      },
      { sourceType: OPENING_SOURCE, sourceId: record.id },
    );
    record.entryId = entry.id;
    await this.openingRepo.save(record);
    return { opening: record, entry };
  }

  /** Creates one posted opening invoice / bill (or credit note / refund) per line. */
  async postPartners(tenantId: string, userId: string, dto: OpeningPartnersDto) {
    const settings = await this.settingsService.get(tenantId);
    const equityAccountId = dto.equityAccountId ?? settings.retainedEarningsAccountId;
    if (!equityAccountId) {
      throw new BadRequestException(
        'Choose an opening balance equity account (or configure retained earnings in the accounting settings)',
      );
    }
    if (!(await this.accountRepo.count({ where: { tenantId, id: equityAccountId } }))) {
      throw new NotFoundException('Equity account not found');
    }
    await this.autoPosting.preflight(tenantId, dto.date, ['receivableAccountId', 'payableAccountId']);

    const results = [];
    for (const doc of dto.documents) {
      if (!round(doc.amount, 4)) throw new BadRequestException('Opening amounts cannot be zero');
      results.push(
        doc.partnerType === 'customer'
          ? await this.openCustomer(tenantId, userId, dto.date, equityAccountId, doc)
          : await this.openSupplier(tenantId, userId, dto.date, equityAccountId, doc),
      );
    }
    return results;
  }

  private async openCustomer(
    tenantId: string,
    userId: string,
    date: string,
    equityAccountId: string,
    doc: OpeningPartnerDocumentDto,
  ) {
    const customer = await this.customerRepo.findOne({ where: { id: doc.partnerId, tenantId } });
    if (!customer) throw new NotFoundException(`Customer ${doc.partnerId} not found`);
    const credit = doc.amount < 0;
    const amount = round(Math.abs(doc.amount), 4);
    const rate = Number(doc.exchangeRate ?? 1) || 1;
    const invoice = await this.salesInvoiceRepo.save(
      this.salesInvoiceRepo.create({
        tenantId,
        customerId: customer.id,
        invoiceNumber: await this.sequenceService.next(tenantId, 'opening_invoice', 'OB-INV'),
        date,
        dueDate: doc.dueDate ?? date,
        status: SalesInvoiceStatus.POSTED,
        moveType: credit ? SalesInvoiceType.CREDIT_NOTE : SalesInvoiceType.INVOICE,
        subtotal: 0,
        taxAmount: 0,
        totalAmount: amount,
        paidAmount: 0,
        currencyId: doc.currencyId,
        exchangeRate: rate,
        branchId: doc.branchId,
        notes: `Opening balance${doc.reference ? ` - ${doc.reference}` : ''}`,
        createdBy: userId,
        postedAt: new Date(),
        lines: [],
      }),
    );
    // sourceType sales_invoice: cancelling the invoice reverses this entry.
    const entry = await this.autoPosting.post({
      tenantId,
      userId,
      journalType: JournalType.SALE,
      date,
      description: `Opening balance ${invoice.invoiceNumber}`,
      sourceType: 'sales_invoice',
      sourceId: invoice.id,
      currencyId: doc.currencyId,
      exchangeRate: rate,
      buildLines: (_s, account) => [
        { accountId: account('receivableAccountId'), [credit ? 'credit' : 'debit']: amount },
        { accountId: equityAccountId, [credit ? 'debit' : 'credit']: amount },
      ],
    });
    await this.customerRepo
      .createQueryBuilder()
      .update(Customer)
      .set({ balance: () => `balance + (:delta)` })
      .setParameter('delta', credit ? -amount : amount)
      .where('id = :id AND tenant_id = :tenantId', { id: customer.id, tenantId })
      .execute();
    return this.record(tenantId, userId, OpeningBalanceKind.CUSTOMER, date, doc, invoice, equityAccountId, entry?.id);
  }

  private async openSupplier(
    tenantId: string,
    userId: string,
    date: string,
    equityAccountId: string,
    doc: OpeningPartnerDocumentDto,
  ) {
    const supplier = await this.supplierRepo.findOne({ where: { id: doc.partnerId, tenantId } });
    if (!supplier) throw new NotFoundException(`Supplier ${doc.partnerId} not found`);
    const debit = doc.amount < 0;
    const amount = round(Math.abs(doc.amount), 4);
    const rate = Number(doc.exchangeRate ?? 1) || 1;
    const bill = await this.purchaseInvoiceRepo.save(
      this.purchaseInvoiceRepo.create({
        tenantId,
        supplierId: supplier.id,
        invoiceNumber: await this.sequenceService.next(tenantId, 'opening_bill', 'OB-BILL'),
        date,
        dueDate: doc.dueDate ?? date,
        status: PurchaseInvoiceStatus.APPROVED,
        moveType: debit ? PurchaseInvoiceType.REFUND : PurchaseInvoiceType.BILL,
        subtotal: 0,
        taxAmount: 0,
        totalAmount: amount,
        paidAmount: 0,
        currencyId: doc.currencyId,
        exchangeRate: rate,
        branchId: doc.branchId,
        supplierReference: doc.reference,
        notes: `Opening balance${doc.reference ? ` - ${doc.reference}` : ''}`,
        createdBy: userId,
        postedAt: new Date(),
        lines: [],
      }),
    );
    const entry = await this.autoPosting.post({
      tenantId,
      userId,
      journalType: JournalType.PURCHASE,
      date,
      description: `Opening balance ${bill.invoiceNumber}`,
      sourceType: 'purchase_invoice',
      sourceId: bill.id,
      currencyId: doc.currencyId,
      exchangeRate: rate,
      buildLines: (_s, account) => [
        { accountId: equityAccountId, [debit ? 'credit' : 'debit']: amount },
        { accountId: account('payableAccountId'), [debit ? 'debit' : 'credit']: amount },
      ],
    });
    await this.supplierRepo
      .createQueryBuilder()
      .update(Supplier)
      .set({ balance: () => `balance + (:delta)` })
      .setParameter('delta', debit ? -amount : amount)
      .where('id = :id AND tenant_id = :tenantId', { id: supplier.id, tenantId })
      .execute();
    return this.record(tenantId, userId, OpeningBalanceKind.SUPPLIER, date, doc, bill, equityAccountId, entry?.id);
  }

  private async record(
    tenantId: string,
    userId: string,
    kind: OpeningBalanceKind,
    date: string,
    doc: OpeningPartnerDocumentDto,
    document: { id: string; invoiceNumber: string },
    equityAccountId: string,
    entryId?: string,
  ) {
    return this.openingRepo.save(
      this.openingRepo.create({
        tenantId,
        kind,
        date,
        partnerId: doc.partnerId,
        documentId: document.id,
        documentNumber: document.invoiceNumber,
        amount: round(doc.amount, 4),
        currencyId: doc.currencyId ?? null,
        exchangeRate: Number(doc.exchangeRate ?? 1) || 1,
        equityAccountId,
        entryId: entryId ?? null,
        description: doc.reference,
        createdBy: userId,
      }),
    );
  }
}
