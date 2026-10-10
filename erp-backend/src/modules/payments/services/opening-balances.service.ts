import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  OpeningBalanceStatus,
  PartnerOpeningBalance,
  PartnerOpeningBalanceLine,
} from '../entities/partner-opening-balance.entity';
import { PaymentPartnerType } from '../entities/payment.entity';
import { CreateOpeningBalanceDto } from '../dto/opening-balance.dto';
import { Customer } from '@modules/sales/entities/customer.entity';
import { Supplier } from '@modules/purchasing/entities/supplier.entity';
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
import { SalesInvoicesService } from '@modules/sales/services/sales-invoices.service';
import { PurchaseInvoicesService } from '@modules/purchasing/services/purchase-invoices.service';
import {
  AutoPostingService,
  PostingLine,
  SettingsAccountKey,
} from '@modules/accounting/services/auto-posting.service';
import { AccountingSettingsService } from '@modules/accounting/services/accounting-settings.service';
import { JournalType } from '@modules/accounting/entities/journal.entity';
import { SequenceService } from '@shared/services/sequence.service';
import { round, today } from '@shared/utils/document-totals.util';

/**
 * Journal lines of an opening balance document. Customer balances are
 * receivable debits (credits when negative), supplier balances payable
 * credits; the opposite side goes to the opening balance equity account.
 */
export function openingBalanceLines(
  lines: Pick<PartnerOpeningBalanceLine, 'partnerType' | 'amount'>[],
  accounts: { receivable: string; payable: string; equity: string },
): PostingLine[] {
  const result: PostingLine[] = [];
  let equity = 0; // net credit to equity
  for (const line of lines) {
    const amount = round(Number(line.amount), 4);
    const value = Math.abs(amount);
    if (line.partnerType === PaymentPartnerType.CUSTOMER) {
      result.push({ accountId: accounts.receivable, [amount > 0 ? 'debit' : 'credit']: value });
      equity = round(equity + amount, 4);
    } else {
      result.push({ accountId: accounts.payable, [amount > 0 ? 'credit' : 'debit']: value });
      equity = round(equity - amount, 4);
    }
  }
  if (equity !== 0) {
    result.push({ accountId: accounts.equity, [equity > 0 ? 'credit' : 'debit']: Math.abs(equity) });
  }
  return result;
}

/**
 * Opening balances of customers and suppliers (Instasoft first_balance).
 * draft → posted → cancelled. Each line becomes an open item (line-less
 * invoice / credit note or bill / refund flagged with `openingBalanceId`) so
 * that aged balances, statements, payment allocation and write-offs treat
 * opening balances like any other open document.
 */
@Injectable()
export class OpeningBalancesService {
  constructor(
    @InjectRepository(PartnerOpeningBalance)
    private readonly documentRepo: Repository<PartnerOpeningBalance>,
    @InjectRepository(PartnerOpeningBalanceLine)
    private readonly lineRepo: Repository<PartnerOpeningBalanceLine>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    @InjectRepository(Supplier)
    private readonly supplierRepo: Repository<Supplier>,
    @InjectRepository(SalesInvoice)
    private readonly salesInvoiceRepo: Repository<SalesInvoice>,
    @InjectRepository(PurchaseInvoice)
    private readonly purchaseInvoiceRepo: Repository<PurchaseInvoice>,
    private readonly salesInvoices: SalesInvoicesService,
    private readonly purchaseInvoices: PurchaseInvoicesService,
    private readonly autoPosting: AutoPostingService,
    private readonly accountingSettings: AccountingSettingsService,
    private readonly sequenceService: SequenceService,
  ) {}

  findAll(tenantId: string, status?: OpeningBalanceStatus): Promise<PartnerOpeningBalance[]> {
    const where: Record<string, unknown> = { tenantId };
    if (status) where.status = status;
    return this.documentRepo.find({
      where,
      relations: ['lines'],
      order: { date: 'DESC', createdAt: 'DESC' },
    });
  }

  async findById(tenantId: string, id: string): Promise<PartnerOpeningBalance> {
    const doc = await this.documentRepo.findOne({ where: { id, tenantId }, relations: ['lines'] });
    if (!doc) throw new NotFoundException('Opening balance document not found');
    return doc;
  }

  async create(
    tenantId: string,
    userId: string,
    dto: CreateOpeningBalanceDto,
  ): Promise<PartnerOpeningBalance> {
    const date = dto.date || today();
    await this.assertPartners(tenantId, dto.lines);
    const lines = dto.lines.map((l) => {
      const amount = round(Number(l.amount), 4);
      if (amount === 0) throw new BadRequestException('Opening balance lines cannot be zero');
      const originalDate = l.originalDate ?? null;
      if (originalDate && originalDate > date) {
        throw new BadRequestException('The original date cannot be after the opening date');
      }
      return this.lineRepo.create({
        partnerType: l.partnerType,
        partnerId: l.partnerId,
        amount,
        originalDate,
        dueDate: l.dueDate ?? null,
        reference: l.reference ?? null,
        openItemId: null,
      });
    });
    const total = (type: PaymentPartnerType) =>
      round(
        lines.filter((l) => l.partnerType === type).reduce((s, l) => s + Number(l.amount), 0),
        4,
      );

    const doc = await this.documentRepo.save(
      this.documentRepo.create({
        tenantId,
        documentNumber: await this.sequenceService.next(tenantId, 'partner_opening_balance', 'OB'),
        date,
        status: OpeningBalanceStatus.DRAFT,
        notes: dto.notes ?? null,
        customerTotal: total(PaymentPartnerType.CUSTOMER),
        supplierTotal: total(PaymentPartnerType.SUPPLIER),
        createdBy: userId,
        lines,
      }),
    );
    if (dto.post) return this.post(tenantId, userId, doc.id);
    return this.findById(tenantId, doc.id);
  }

  async post(tenantId: string, userId: string, id: string): Promise<PartnerOpeningBalance> {
    const doc = await this.findById(tenantId, id);
    if (doc.status !== OpeningBalanceStatus.DRAFT) {
      throw new ConflictException('Only draft opening balances can be posted');
    }
    const hasCustomers = doc.lines.some((l) => l.partnerType === PaymentPartnerType.CUSTOMER);
    const hasSuppliers = doc.lines.some((l) => l.partnerType === PaymentPartnerType.SUPPLIER);
    const settings = await this.accountingSettings.find(tenantId);
    const equityKey: SettingsAccountKey = settings?.openingBalanceEquityAccountId
      ? 'openingBalanceEquityAccountId'
      : 'retainedEarningsAccountId';
    const keys: SettingsAccountKey[] = [equityKey];
    if (hasCustomers) keys.push('receivableAccountId');
    if (hasSuppliers) keys.push('payableAccountId');
    await this.autoPosting.preflight(tenantId, doc.date, keys);

    await this.autoPosting.post({
      tenantId,
      userId,
      journalType: JournalType.GENERAL,
      date: doc.date,
      description: `Partner opening balances ${doc.documentNumber}`,
      sourceType: 'partner_opening_balance',
      sourceId: doc.id,
      buildLines: (_s, account) =>
        openingBalanceLines(doc.lines, {
          receivable: hasCustomers ? account('receivableAccountId') : '',
          payable: hasSuppliers ? account('payableAccountId') : '',
          equity: account(equityKey),
        }),
    });

    let seq = 0;
    for (const line of doc.lines) {
      seq += 1;
      const number = `${doc.documentNumber}/${seq}`;
      const amount = Number(line.amount);
      const value = Math.abs(amount);
      const issued = line.originalDate ?? doc.date;
      const dueDate = line.dueDate ?? issued;
      const notes = `Opening balance ${doc.documentNumber}${line.reference ? ` (${line.reference})` : ''}`;
      if (line.partnerType === PaymentPartnerType.CUSTOMER) {
        const item = await this.salesInvoiceRepo.save(
          this.salesInvoiceRepo.create({
            tenantId,
            customerId: line.partnerId,
            invoiceNumber: number,
            date: issued,
            dueDate,
            status: SalesInvoiceStatus.POSTED,
            moveType: amount > 0 ? SalesInvoiceType.INVOICE : SalesInvoiceType.CREDIT_NOTE,
            subtotal: value,
            taxAmount: 0,
            totalAmount: value,
            paidAmount: 0,
            exchangeRate: 1,
            notes,
            createdBy: userId,
            postedAt: new Date(),
            openingBalanceId: doc.id,
            lines: [],
          }),
        );
        line.openItemId = item.id;
        await this.salesInvoices.adjustCustomerBalance(tenantId, line.partnerId, amount);
      } else {
        const item = await this.purchaseInvoiceRepo.save(
          this.purchaseInvoiceRepo.create({
            tenantId,
            supplierId: line.partnerId,
            invoiceNumber: number,
            supplierReference: line.reference ?? undefined,
            date: issued,
            dueDate,
            status: PurchaseInvoiceStatus.APPROVED,
            moveType: amount > 0 ? PurchaseInvoiceType.BILL : PurchaseInvoiceType.REFUND,
            subtotal: value,
            taxAmount: 0,
            totalAmount: value,
            paidAmount: 0,
            exchangeRate: 1,
            notes,
            createdBy: userId,
            postedAt: new Date(),
            openingBalanceId: doc.id,
            lines: [],
          }),
        );
        line.openItemId = item.id;
        await this.purchaseInvoices.adjustSupplierBalance(tenantId, line.partnerId, amount);
      }
    }
    await this.lineRepo.save(doc.lines);

    doc.status = OpeningBalanceStatus.POSTED;
    doc.postedAt = new Date();
    const { lines: _l, ...header } = doc;
    await this.documentRepo.save(header as PartnerOpeningBalance);
    return this.findById(tenantId, id);
  }

  /**
   * Cancels a draft, or a posted document whose open items are still fully
   * open (no payment, credit or write-off applied): the entry is reversed,
   * the open items cancelled and the partner balances restored.
   */
  async cancel(tenantId: string, userId: string, id: string): Promise<PartnerOpeningBalance> {
    const doc = await this.findById(tenantId, id);
    if (doc.status === OpeningBalanceStatus.CANCELLED) {
      throw new ConflictException('The opening balance document is already cancelled');
    }
    if (doc.status === OpeningBalanceStatus.POSTED) {
      const sales = await this.salesInvoiceRepo.find({
        where: { tenantId, openingBalanceId: doc.id },
      });
      const bills = await this.purchaseInvoiceRepo.find({
        where: { tenantId, openingBalanceId: doc.id },
      });
      const settled = [...sales, ...bills].find((d) => Number(d.paidAmount) > 0);
      if (settled) {
        throw new ConflictException(
          `Open item ${settled.invoiceNumber} is already (partly) settled; cancel its payments first`,
        );
      }
      await this.autoPosting.reverseSource(tenantId, userId, 'partner_opening_balance', doc.id);
      for (const s of sales) s.status = SalesInvoiceStatus.CANCELLED;
      for (const b of bills) b.status = PurchaseInvoiceStatus.CANCELLED;
      if (sales.length) await this.salesInvoiceRepo.save(sales);
      if (bills.length) await this.purchaseInvoiceRepo.save(bills);
      for (const line of doc.lines) {
        if (line.partnerType === PaymentPartnerType.CUSTOMER) {
          await this.salesInvoices.adjustCustomerBalance(tenantId, line.partnerId, -Number(line.amount));
        } else {
          await this.purchaseInvoices.adjustSupplierBalance(tenantId, line.partnerId, -Number(line.amount));
        }
      }
    }
    doc.status = OpeningBalanceStatus.CANCELLED;
    const { lines: _l, ...header } = doc;
    await this.documentRepo.save(header as PartnerOpeningBalance);
    return this.findById(tenantId, id);
  }

  private async assertPartners(
    tenantId: string,
    lines: { partnerType: PaymentPartnerType; partnerId: string }[],
  ) {
    const ids = (type: PaymentPartnerType) => [
      ...new Set(lines.filter((l) => l.partnerType === type).map((l) => l.partnerId)),
    ];
    const customers = ids(PaymentPartnerType.CUSTOMER);
    const suppliers = ids(PaymentPartnerType.SUPPLIER);
    if (customers.length) {
      const found = await this.customerRepo.find({ where: { tenantId, id: In(customers) } });
      if (found.length !== customers.length) throw new NotFoundException('Customer not found');
    }
    if (suppliers.length) {
      const found = await this.supplierRepo.find({ where: { tenantId, id: In(suppliers) } });
      if (found.length !== suppliers.length) throw new NotFoundException('Supplier not found');
    }
  }
}
