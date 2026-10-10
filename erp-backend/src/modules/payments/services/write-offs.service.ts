import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  PartnerWriteOff,
  PartnerWriteOffLine,
  WriteOffKind,
  WriteOffStatus,
} from '../entities/partner-write-off.entity';
import { PaymentDirection, PaymentPartnerType } from '../entities/payment.entity';
import { CreateWriteOffDto, WriteOffLineDto, WriteOffQueryDto } from '../dto/write-off.dto';
import { PaymentsService } from './payments.service';
import { Customer } from '@modules/sales/entities/customer.entity';
import { Supplier } from '@modules/purchasing/entities/supplier.entity';
import { SalesInvoice } from '@modules/sales/entities/sales-invoice.entity';
import { PurchaseInvoice } from '@modules/purchasing/entities/purchase-invoice.entity';
import { SalesInvoicesService } from '@modules/sales/services/sales-invoices.service';
import { PurchaseInvoicesService } from '@modules/purchasing/services/purchase-invoices.service';
import { Account } from '@modules/accounting/entities/account.entity';
import {
  AutoPostingService,
  SettingsAccountKey,
} from '@modules/accounting/services/auto-posting.service';
import { JournalType } from '@modules/accounting/entities/journal.entity';
import { SequenceService } from '@shared/services/sequence.service';
import { residual, round, today } from '@shared/utils/document-totals.util';

type OpenDocument = SalesInvoice | PurchaseInvoice;

/**
 * Settings account a write-off is booked against when no explicit account is
 * given: customer → bad debt / discount allowed (expense), supplier →
 * write-off income / discount received (income).
 */
export function writeOffAccountKey(
  partnerType: PaymentPartnerType,
  kind: WriteOffKind,
): SettingsAccountKey | null {
  if (kind === WriteOffKind.CUSTOM) return null;
  if (partnerType === PaymentPartnerType.CUSTOMER) {
    return kind === WriteOffKind.DISCOUNT ? 'salesDiscountAccountId' : 'badDebtExpenseAccountId';
  }
  return kind === WriteOffKind.DISCOUNT ? 'purchaseDiscountAccountId' : 'writeOffIncomeAccountId';
}

/**
 * Spreads `amount` (default: everything open) over open documents oldest
 * first. Returns the allocation lines.
 */
export function allocateOldestFirst(
  documents: Pick<OpenDocument, 'id' | 'totalAmount' | 'paidAmount'>[],
  amount?: number,
): WriteOffLineDto[] {
  const lines: WriteOffLineDto[] = [];
  let remaining = amount === undefined ? Infinity : round(amount, 4);
  for (const doc of documents) {
    if (remaining <= 0) break;
    const open = residual(doc.totalAmount, doc.paidAmount);
    const take = round(Math.min(open, remaining), 4);
    if (take > 0) {
      lines.push({ invoiceId: doc.id, amount: take });
      if (remaining !== Infinity) remaining = round(remaining - take, 4);
    }
  }
  if (remaining !== Infinity && remaining > 0.0001) {
    throw new BadRequestException(
      `The amount exceeds the open balance of the partner's documents by ${remaining}`,
    );
  }
  return lines;
}

/**
 * Partner balance write-offs (Instasoft writeoff.vb): customer residuals to
 * bad debt / discount allowed, supplier residuals to write-off income /
 * discount received. draft → posted → cancelled (reversal).
 *
 * Posting reconciles each document like a payment allocation (invoice paid
 * amount and status, installment schedule, partner balance) and posts
 * Dr expense / Cr receivable, or Dr payable / Cr income.
 */
@Injectable()
export class WriteOffsService {
  constructor(
    @InjectRepository(PartnerWriteOff)
    private readonly writeOffRepo: Repository<PartnerWriteOff>,
    @InjectRepository(PartnerWriteOffLine)
    private readonly lineRepo: Repository<PartnerWriteOffLine>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    @InjectRepository(Supplier)
    private readonly supplierRepo: Repository<Supplier>,
    @InjectRepository(SalesInvoice)
    private readonly salesInvoiceRepo: Repository<SalesInvoice>,
    @InjectRepository(PurchaseInvoice)
    private readonly purchaseInvoiceRepo: Repository<PurchaseInvoice>,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    private readonly payments: PaymentsService,
    private readonly salesInvoices: SalesInvoicesService,
    private readonly purchaseInvoices: PurchaseInvoicesService,
    private readonly autoPosting: AutoPostingService,
    private readonly sequenceService: SequenceService,
  ) {}

  findAll(
    tenantId: string,
    partnerType: PaymentPartnerType,
    query: WriteOffQueryDto = {},
  ): Promise<PartnerWriteOff[]> {
    const where: Record<string, unknown> = { tenantId, partnerType };
    if (query.partnerId) where.partnerId = query.partnerId;
    if (query.status) where.status = query.status;
    return this.writeOffRepo.find({
      where,
      relations: ['lines'],
      order: { date: 'DESC', createdAt: 'DESC' },
    });
  }

  async findById(
    tenantId: string,
    partnerType: PaymentPartnerType,
    id: string,
  ): Promise<PartnerWriteOff> {
    const writeOff = await this.writeOffRepo.findOne({
      where: { id, tenantId, partnerType },
      relations: ['lines'],
    });
    if (!writeOff) throw new NotFoundException('Write-off not found');
    return writeOff;
  }

  async create(
    tenantId: string,
    userId: string,
    partnerType: PaymentPartnerType,
    dto: CreateWriteOffDto,
  ): Promise<PartnerWriteOff> {
    await this.assertPartner(tenantId, partnerType, dto.partnerId);
    const kind = dto.kind ?? WriteOffKind.WRITE_OFF;
    if (kind === WriteOffKind.CUSTOM && !dto.accountId) {
      throw new BadRequestException('accountId is required for a custom write-off');
    }
    if (dto.accountId) await this.assertAccount(tenantId, dto.accountId);

    const open = await this.openDocuments(tenantId, partnerType, dto.partnerId);
    const requested = dto.lines?.length
      ? dto.lines
      : allocateOldestFirst(open, dto.amount);
    if (!requested.length) throw new BadRequestException('The partner has no open balance to write off');
    const lines = this.validateLines(open, requested);

    const writeOff = await this.writeOffRepo.save(
      this.writeOffRepo.create({
        tenantId,
        writeOffNumber: await this.sequenceService.next(tenantId, 'partner_write_off', 'WO'),
        partnerType,
        partnerId: dto.partnerId,
        date: dto.date || today(),
        kind,
        accountId: dto.accountId ?? null,
        amount: round(lines.reduce((s, l) => s + l.amount, 0), 4),
        reason: dto.reason ?? null,
        status: WriteOffStatus.DRAFT,
        createdBy: userId,
        lines: lines.map((l) => this.lineRepo.create(l)),
      }),
    );
    if (dto.post) return this.post(tenantId, userId, partnerType, writeOff.id);
    return this.findById(tenantId, partnerType, writeOff.id);
  }

  /** Posts a draft: re-validates the residuals, posts the entry and reconciles the documents. */
  async post(
    tenantId: string,
    userId: string,
    partnerType: PaymentPartnerType,
    id: string,
  ): Promise<PartnerWriteOff> {
    const writeOff = await this.findById(tenantId, partnerType, id);
    if (writeOff.status !== WriteOffStatus.DRAFT) {
      throw new ConflictException('Only draft write-offs can be posted');
    }
    const isCustomer = partnerType === PaymentPartnerType.CUSTOMER;
    const open = await this.openDocuments(tenantId, partnerType, writeOff.partnerId);
    this.validateLines(
      open,
      writeOff.lines.map((l) => ({ invoiceId: l.invoiceId, amount: Number(l.amount) })),
    );

    const counterKey = writeOffAccountKey(partnerType, writeOff.kind);
    const partnerKey: SettingsAccountKey = isCustomer ? 'receivableAccountId' : 'payableAccountId';
    await this.autoPosting.preflight(
      tenantId,
      writeOff.date,
      counterKey ? [partnerKey, counterKey] : [partnerKey],
    );

    // One entry per document currency / rate so the partner account is
    // relieved at the value the documents were booked at.
    const byId = new Map(open.map((d) => [d.id, d]));
    const groups = new Map<string, { currencyId?: string; rate: number; amount: number }>();
    for (const line of writeOff.lines) {
      const doc = byId.get(line.invoiceId)!;
      const rate = Number(doc.exchangeRate ?? 1) || 1;
      const key = `${doc.currencyId ?? ''}|${rate}`;
      const group = groups.get(key) ?? { currencyId: doc.currencyId ?? undefined, rate, amount: 0 };
      group.amount = round(group.amount + Number(line.amount), 4);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      await this.autoPosting.post({
        tenantId,
        userId,
        journalType: JournalType.GENERAL,
        date: writeOff.date,
        description: `Write-off ${writeOff.writeOffNumber}${writeOff.reason ? ` - ${writeOff.reason}` : ''}`,
        sourceType: 'partner_write_off',
        sourceId: writeOff.id,
        currencyId: group.currencyId,
        exchangeRate: group.rate,
        buildLines: (_s, account) => {
          const counter = counterKey ? account(counterKey) : writeOff.accountId!;
          const partner = account(partnerKey);
          return isCustomer
            ? [
                { accountId: counter, debit: group.amount },
                { accountId: partner, credit: group.amount },
              ]
            : [
                { accountId: partner, debit: group.amount },
                { accountId: counter, credit: group.amount },
              ];
        },
      });
    }

    for (const line of writeOff.lines) {
      await this.applyToDocument(partnerType, byId.get(line.invoiceId)!, Number(line.amount));
    }
    await this.adjustBalance(tenantId, partnerType, writeOff.partnerId, -Number(writeOff.amount));

    writeOff.status = WriteOffStatus.POSTED;
    writeOff.postedAt = new Date();
    const { lines: _l, ...header } = writeOff;
    await this.writeOffRepo.save(header as PartnerWriteOff);
    return this.findById(tenantId, partnerType, id);
  }

  /** Cancels a draft, or reverses a posted write-off and re-opens its documents. */
  async cancel(
    tenantId: string,
    userId: string,
    partnerType: PaymentPartnerType,
    id: string,
  ): Promise<PartnerWriteOff> {
    const writeOff = await this.findById(tenantId, partnerType, id);
    if (writeOff.status === WriteOffStatus.CANCELLED) {
      throw new ConflictException('The write-off is already cancelled');
    }
    if (writeOff.status === WriteOffStatus.POSTED) {
      await this.autoPosting.reverseSource(tenantId, userId, 'partner_write_off', writeOff.id);
      for (const line of writeOff.lines) {
        const doc = await this.loadDocument(tenantId, partnerType, line.invoiceId);
        await this.applyToDocument(partnerType, doc, -Number(line.amount));
      }
      await this.adjustBalance(tenantId, partnerType, writeOff.partnerId, Number(writeOff.amount));
    }
    writeOff.status = WriteOffStatus.CANCELLED;
    writeOff.cancelledAt = new Date();
    const { lines: _l, ...header } = writeOff;
    await this.writeOffRepo.save(header as PartnerWriteOff);
    return this.findById(tenantId, partnerType, id);
  }

  private openDocuments(
    tenantId: string,
    partnerType: PaymentPartnerType,
    partnerId: string,
  ): Promise<OpenDocument[]> {
    return this.payments.openDocuments(tenantId, {
      partnerType,
      partnerId,
      // Receipts settle customer invoices; payments settle vendor bills.
      direction:
        partnerType === PaymentPartnerType.CUSTOMER
          ? PaymentDirection.INBOUND
          : PaymentDirection.OUTBOUND,
    });
  }

  /** Every line must target a distinct open document and stay within its residual. */
  private validateLines(open: OpenDocument[], lines: WriteOffLineDto[]) {
    const byId = new Map(open.map((d) => [d.id, d]));
    const seen = new Set<string>();
    return lines.map((l) => {
      const doc = byId.get(l.invoiceId);
      if (!doc) {
        throw new BadRequestException(
          `Document ${l.invoiceId} is not an open invoice/bill of this partner`,
        );
      }
      if (seen.has(l.invoiceId)) {
        throw new BadRequestException(`Document ${doc.invoiceNumber} appears twice`);
      }
      seen.add(l.invoiceId);
      const amount = round(Number(l.amount), 4);
      const open = residual(doc.totalAmount, doc.paidAmount);
      if (!(amount > 0) || amount > open + 0.0001) {
        throw new BadRequestException(
          `Write-off of ${amount} on ${doc.invoiceNumber} exceeds its residual ${open}`,
        );
      }
      return { invoiceId: doc.id, invoiceNumber: doc.invoiceNumber, amount };
    });
  }

  private async loadDocument(
    tenantId: string,
    partnerType: PaymentPartnerType,
    id: string,
  ): Promise<OpenDocument> {
    const doc =
      partnerType === PaymentPartnerType.CUSTOMER
        ? await this.salesInvoiceRepo.findOne({ where: { id, tenantId } })
        : await this.purchaseInvoiceRepo.findOne({ where: { id, tenantId } });
    if (!doc) throw new NotFoundException(`Document ${id} not found`);
    return doc;
  }

  private applyToDocument(partnerType: PaymentPartnerType, doc: OpenDocument, amount: number) {
    return partnerType === PaymentPartnerType.CUSTOMER
      ? this.salesInvoices.applyPayment(doc as SalesInvoice, amount)
      : this.purchaseInvoices.applyPayment(doc as PurchaseInvoice, amount);
  }

  private adjustBalance(
    tenantId: string,
    partnerType: PaymentPartnerType,
    partnerId: string,
    delta: number,
  ) {
    return partnerType === PaymentPartnerType.CUSTOMER
      ? this.salesInvoices.adjustCustomerBalance(tenantId, partnerId, delta)
      : this.purchaseInvoices.adjustSupplierBalance(tenantId, partnerId, delta);
  }

  private async assertPartner(tenantId: string, partnerType: PaymentPartnerType, id: string) {
    const partner =
      partnerType === PaymentPartnerType.CUSTOMER
        ? await this.customerRepo.findOne({ where: { id, tenantId } })
        : await this.supplierRepo.findOne({ where: { id, tenantId } });
    if (!partner) {
      throw new NotFoundException(
        `${partnerType === PaymentPartnerType.CUSTOMER ? 'Customer' : 'Supplier'} not found`,
      );
    }
  }

  private async assertAccount(tenantId: string, id: string) {
    const account = await this.accountRepo.findOne({ where: { id, tenantId } });
    if (!account) throw new NotFoundException('Account not found');
    if (!account.isActive || !account.allowPosting) {
      throw new BadRequestException(`Account ${account.code} does not allow posting`);
    }
  }
}
