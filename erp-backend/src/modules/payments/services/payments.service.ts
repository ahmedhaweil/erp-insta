import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  Payment,
  PaymentDirection,
  PaymentMethod,
  PaymentPartnerType,
  PaymentStatus,
} from '../entities/payment.entity';
import { PaymentAllocation } from '../entities/payment-allocation.entity';
import {
  AllocatePaymentDto,
  CreatePaymentDto,
  PaymentAllocationDto,
} from '../dto/create-payment.dto';
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
import { JournalType } from '@modules/accounting/entities/journal.entity';
import { Treasury, TreasuryType } from '@modules/treasury/entities/treasury.entity';
import { Cheque, ChequeStatus, ChequeType } from '@modules/treasury/entities/cheque.entity';
import { SequenceService } from '@shared/services/sequence.service';
import { residual, round } from '@shared/utils/document-totals.util';

const OPEN_SALES = [
  SalesInvoiceStatus.POSTED,
  SalesInvoiceStatus.SENT,
  SalesInvoiceStatus.PARTIAL,
  SalesInvoiceStatus.OVERDUE,
];
const OPEN_PURCHASE = [
  PurchaseInvoiceStatus.APPROVED,
  PurchaseInvoiceStatus.PARTIAL,
  PurchaseInvoiceStatus.OVERDUE,
];

type OpenDocument = SalesInvoice | PurchaseInvoice;

/** Amount a payment settles on the partner: cash/cheque amount plus tax withheld and discount. */
export function settledAmount(
  payment: Pick<Payment, 'amount' | 'withholdingAmount'> & Partial<Pick<Payment, 'discountAllowed'>>,
): number {
  return round(
    Number(payment.amount) +
      Number(payment.withholdingAmount || 0) +
      Number(payment.discountAllowed || 0),
    4,
  );
}

/** True for customer receipts and supplier payments (as opposed to refunds). */
function isSettlement(payment: Pick<Payment, 'partnerType' | 'direction'>): boolean {
  return payment.partnerType === PaymentPartnerType.CUSTOMER
    ? payment.direction === PaymentDirection.INBOUND
    : payment.direction === PaymentDirection.OUTBOUND;
}

/**
 * Customer and vendor payments (Odoo account.payment) with partial payments,
 * reconciliation against invoices/bills, refunds of credit notes and
 * advances that stay unallocated until reconciled.
 *
 * Payments go through a treasury (cash box / bank account) or the default
 * cash/bank accounts; cheque payments post to notes receivable/payable and
 * create a Cheque whose lifecycle is driven by the treasury module. Foreign
 * currency payments post realised exchange differences against invoices
 * booked at another rate, and tax withheld at source is posted to the
 * withholding tax accounts while the partner is settled for the gross amount.
 */
@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(PaymentAllocation)
    private readonly allocationRepo: Repository<PaymentAllocation>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    @InjectRepository(Supplier)
    private readonly supplierRepo: Repository<Supplier>,
    @InjectRepository(SalesInvoice)
    private readonly salesInvoiceRepo: Repository<SalesInvoice>,
    @InjectRepository(PurchaseInvoice)
    private readonly purchaseInvoiceRepo: Repository<PurchaseInvoice>,
    @InjectRepository(Treasury)
    private readonly treasuryRepo: Repository<Treasury>,
    @InjectRepository(Cheque)
    private readonly chequeRepo: Repository<Cheque>,
    private readonly salesInvoices: SalesInvoicesService,
    private readonly purchaseInvoices: PurchaseInvoicesService,
    private readonly autoPosting: AutoPostingService,
    private readonly sequenceService: SequenceService,
  ) {}

  findAll(tenantId: string, partnerId?: string, treasuryId?: string): Promise<Payment[]> {
    const where: any = { tenantId };
    if (partnerId) where.partnerId = partnerId;
    if (treasuryId) where.treasuryId = treasuryId;
    return this.paymentRepo.find({
      where,
      relations: ['allocations'],
      order: { date: 'DESC', createdAt: 'DESC' },
    });
  }

  async findById(tenantId: string, id: string): Promise<Payment> {
    const payment = await this.paymentRepo.findOne({
      where: { id, tenantId },
      relations: ['allocations'],
    });
    if (!payment) throw new NotFoundException('Payment not found');
    return payment;
  }

  async create(tenantId: string, userId: string, dto: CreatePaymentDto): Promise<Payment> {
    const isCustomer = dto.partnerType === PaymentPartnerType.CUSTOMER;
    const partner = isCustomer
      ? await this.customerRepo.findOne({ where: { id: dto.partnerId, tenantId } })
      : await this.supplierRepo.findOne({ where: { id: dto.partnerId, tenantId } });
    if (!partner) throw new NotFoundException(`${isCustomer ? 'Customer' : 'Supplier'} not found`);

    const direction =
      dto.direction ?? (isCustomer ? PaymentDirection.INBOUND : PaymentDirection.OUTBOUND);
    const inbound = direction === PaymentDirection.INBOUND;
    const amount = round(dto.amount, 4);
    const method = dto.method ?? PaymentMethod.CASH;
    const withholdingAmount = round(dto.withholdingAmount ?? 0, 4);
    const discountAllowed = round(dto.discountAllowed ?? 0, 4);
    let exchangeRate = Number(dto.exchangeRate ?? 1);
    let currencyId = dto.currencyId;

    if (withholdingAmount > 0 && !isSettlement({ partnerType: dto.partnerType, direction })) {
      throw new BadRequestException(
        'Withholding tax applies only to customer receipts and supplier payments',
      );
    }
    if (discountAllowed > 0 && !isSettlement({ partnerType: dto.partnerType, direction })) {
      throw new BadRequestException(
        'A settlement discount applies only to customer receipts and supplier payments',
      );
    }

    // Cheque payments: a received cheque, a newly issued cheque, or the
    // endorsement of a received cheque to a supplier.
    let endorsed: Cheque | null = null;
    if (method === PaymentMethod.CHEQUE) {
      if (dto.endorsedChequeId) {
        if (inbound) throw new BadRequestException('Only outbound payments can endorse a cheque');
        endorsed = await this.chequeRepo.findOne({
          where: { id: dto.endorsedChequeId, tenantId },
        });
        if (!endorsed) throw new NotFoundException('Cheque to endorse not found');
        if (endorsed.type !== ChequeType.RECEIVED || endorsed.status !== ChequeStatus.IN_PORTFOLIO) {
          throw new ConflictException('Only received cheques in the portfolio can be endorsed');
        }
        if (round(Number(endorsed.amount), 4) !== amount) {
          throw new BadRequestException(
            `An endorsement settles the full cheque amount (${Number(endorsed.amount)})`,
          );
        }
        if (currencyId && endorsed.currencyId && currencyId !== endorsed.currencyId) {
          throw new BadRequestException('Payment currency differs from the cheque currency');
        }
        // The note was booked at the cheque's rate and must leave at the same rate.
        currencyId = currencyId ?? endorsed.currencyId;
        exchangeRate = Number(endorsed.exchangeRate) || 1;
      } else if (!dto.cheque) {
        throw new BadRequestException('Cheque details are required for cheque payments');
      }
    } else if (dto.cheque || dto.endorsedChequeId) {
      throw new BadRequestException('Cheque details are only allowed with method "cheque"');
    }
    if (!(exchangeRate > 0)) throw new BadRequestException('Exchange rate must be positive');

    const treasury = dto.treasuryId
      ? await this.loadTreasury(tenantId, dto.treasuryId, currencyId, exchangeRate)
      : null;
    if (method === PaymentMethod.CHEQUE && treasury && treasury.type !== TreasuryType.BANK) {
      throw new BadRequestException('Cheques are drawn on / deposited into bank treasuries only');
    }

    const draft = this.paymentRepo.create({
      tenantId,
      partnerType: dto.partnerType,
      partnerId: dto.partnerId,
      direction,
      date: dto.date,
      amount,
      withholdingAmount,
      discountAllowed,
      allocatedAmount: 0,
      method,
      reference: dto.reference,
      currencyId,
      exchangeRate,
      treasuryId: treasury?.id,
      status: PaymentStatus.POSTED,
      createdBy: userId,
    });
    const keys = this.requiredAccounts(draft, treasury, !!endorsed);
    await this.autoPosting.preflight(tenantId, dto.date, keys);

    draft.paymentNumber = await this.sequenceService.next(
      tenantId,
      inbound ? 'payment_in' : 'payment_out',
      inbound ? 'PAY-IN' : 'PAY-OUT',
    );
    const payment = await this.paymentRepo.save(draft);

    if (method === PaymentMethod.CHEQUE) {
      const cheque = endorsed
        ? await this.endorseCheque(endorsed, payment, userId)
        : await this.createCheque(tenantId, userId, payment, dto);
      payment.chequeId = cheque.id;
      await this.paymentRepo.update(payment.id, { chequeId: cheque.id });
    }

    await this.postJournal(tenantId, userId, payment, treasury, !!endorsed);
    await this.adjustPartnerBalance(tenantId, payment, -1);

    const allocations = dto.allocations?.length
      ? dto.allocations
      : dto.autoAllocate
        ? await this.suggestAllocations(tenantId, payment, settledAmount(payment))
        : [];
    if (allocations.length) {
      await this.applyAllocations(tenantId, userId, payment, allocations);
    }

    return this.findById(tenantId, payment.id);
  }

  /** Reconciles the unallocated part of a payment with open documents. */
  async allocate(
    tenantId: string,
    id: string,
    dto: AllocatePaymentDto,
    userId?: string,
  ): Promise<Payment> {
    const payment = await this.findById(tenantId, id);
    if (payment.status !== PaymentStatus.POSTED) {
      throw new ConflictException('Only posted payments can be allocated');
    }
    await this.applyAllocations(tenantId, userId ?? payment.createdBy, payment, dto.allocations);
    return this.findById(tenantId, id);
  }

  /**
   * Cancels a payment: reverses its journal entries and un-reconciles
   * invoices. A cheque payment can only be cancelled while its cheque is
   * still in the portfolio / issued (later steps go through the cheque).
   */
  async cancel(tenantId: string, userId: string, id: string): Promise<Payment> {
    const payment = await this.findById(tenantId, id);
    if (payment.status !== PaymentStatus.POSTED) {
      throw new ConflictException(`Payment is already ${payment.status}`);
    }

    if (payment.chequeId) {
      const cheque = await this.chequeRepo.findOne({ where: { id: payment.chequeId, tenantId } });
      if (cheque) {
        if (cheque.endorsementPaymentId === payment.id) {
          // Cancelling an endorsement puts the cheque back in the portfolio.
          if (cheque.status !== ChequeStatus.ENDORSED) {
            throw new ConflictException(`Endorsed cheque is ${cheque.status}`);
          }
          this.pushHistory(cheque, payment.date, 'endorsement_cancelled', userId);
          cheque.status = ChequeStatus.IN_PORTFOLIO;
          cheque.endorsedSupplierId = null as any;
          cheque.endorsementPaymentId = null as any;
        } else {
          if (![ChequeStatus.IN_PORTFOLIO, ChequeStatus.ISSUED].includes(cheque.status)) {
            throw new ConflictException(
              `Cheque ${cheque.chequeNumber} is ${cheque.status}; use the cheque actions instead`,
            );
          }
          this.pushHistory(cheque, payment.date, 'cancelled', userId);
          cheque.status = ChequeStatus.CANCELLED;
        }
        await this.chequeRepo.save(cheque);
      }
    }

    return this.revert(tenantId, userId, payment, PaymentStatus.CANCELLED);
  }

  /**
   * Undoes a cheque payment when the cheque bounces or is returned: the
   * payment entries are reversed (dated `date`), invoices re-opened and the
   * partner balance restored. Used by the cheque lifecycle.
   */
  async revertChequePayment(
    tenantId: string,
    userId: string,
    paymentId: string,
    date: string,
  ): Promise<Payment> {
    const payment = await this.findById(tenantId, paymentId);
    if (payment.status !== PaymentStatus.POSTED) {
      throw new ConflictException(`Payment ${payment.paymentNumber} is already ${payment.status}`);
    }
    return this.revert(tenantId, userId, payment, PaymentStatus.BOUNCED, date);
  }

  /** Open documents of the partner that this payment can settle, oldest first. */
  async openDocuments(
    tenantId: string,
    payment: Pick<Payment, 'partnerType' | 'partnerId' | 'direction'>,
  ) {
    if (payment.partnerType === PaymentPartnerType.CUSTOMER) {
      return this.salesInvoiceRepo.find({
        where: {
          tenantId,
          customerId: payment.partnerId,
          status: In(OPEN_SALES),
          moveType:
            payment.direction === PaymentDirection.INBOUND
              ? SalesInvoiceType.INVOICE
              : SalesInvoiceType.CREDIT_NOTE,
        },
        order: { dueDate: 'ASC', date: 'ASC' },
      });
    }
    return this.purchaseInvoiceRepo.find({
      where: {
        tenantId,
        supplierId: payment.partnerId,
        status: In(OPEN_PURCHASE),
        moveType:
          payment.direction === PaymentDirection.OUTBOUND
            ? PurchaseInvoiceType.BILL
            : PurchaseInvoiceType.REFUND,
      },
      order: { dueDate: 'ASC', date: 'ASC' },
    });
  }

  /**
   * Realised exchange difference (base currency) when `amount` of a document
   * booked at `documentRate` is settled at `paymentRate`. Positive = gain.
   * Money in: a higher payment rate is a gain; money out: it is a loss.
   */
  static exchangeDifference(
    inbound: boolean,
    amount: number,
    paymentRate: number,
    documentRate: number,
  ): number {
    const diff = round(amount * (paymentRate - documentRate), 2);
    return inbound ? diff : -diff;
  }

  private async revert(
    tenantId: string,
    userId: string,
    payment: Payment,
    status: PaymentStatus,
    date?: string,
  ): Promise<Payment> {
    for (const allocation of payment.allocations) {
      const document = await this.loadDocument(tenantId, payment, allocation.invoiceId);
      await this.applyToDocument(payment, document, -Number(allocation.amount));
    }
    await this.allocationRepo.delete({ paymentId: payment.id });

    if (date) {
      await this.autoPosting.reverseSource(tenantId, userId, 'payment', payment.id, date);
    } else {
      await this.autoPosting.reverseSource(tenantId, userId, 'payment', payment.id);
    }
    await this.adjustPartnerBalance(tenantId, payment, 1);

    payment.status = status;
    payment.allocatedAmount = 0;
    payment.allocations = [];
    return this.paymentRepo.save(payment);
  }

  private async loadTreasury(
    tenantId: string,
    id: string,
    currencyId: string | undefined,
    exchangeRate: number,
  ): Promise<Treasury> {
    const treasury = await this.treasuryRepo.findOne({ where: { id, tenantId } });
    if (!treasury) throw new NotFoundException('Treasury not found');
    if (!treasury.isActive) throw new ConflictException(`Treasury ${treasury.code} is inactive`);
    if (treasury.currencyId) {
      if (currencyId && currencyId !== treasury.currencyId) {
        throw new BadRequestException(
          `Treasury ${treasury.code} holds another currency than the payment`,
        );
      }
    } else if (currencyId && exchangeRate !== 1) {
      throw new BadRequestException(
        `Treasury ${treasury.code} is in the base currency; foreign currency payments need a treasury in that currency`,
      );
    }
    return treasury;
  }

  private async createCheque(
    tenantId: string,
    userId: string,
    payment: Payment,
    dto: CreatePaymentDto,
  ): Promise<Cheque> {
    const details = dto.cheque!;
    const received = payment.direction === PaymentDirection.INBOUND;
    return this.chequeRepo.save(
      this.chequeRepo.create({
        tenantId,
        type: received ? ChequeType.RECEIVED : ChequeType.ISSUED,
        status: received ? ChequeStatus.IN_PORTFOLIO : ChequeStatus.ISSUED,
        chequeNumber: details.chequeNumber,
        bankName: details.bankName,
        bankBranch: details.bankBranch,
        drawer: details.drawer,
        issueDate: details.issueDate ?? payment.date,
        dueDate: details.dueDate,
        amount: payment.amount,
        currencyId: payment.currencyId,
        exchangeRate: payment.exchangeRate,
        partnerType: payment.partnerType,
        partnerId: payment.partnerId,
        paymentId: payment.id,
        treasuryId: received ? undefined : payment.treasuryId,
        statusDate: payment.date,
        notes: details.notes,
        history: [{ date: payment.date, action: received ? 'received' : 'issued', userId }],
      }),
    );
  }

  private async endorseCheque(cheque: Cheque, payment: Payment, userId: string): Promise<Cheque> {
    cheque.status = ChequeStatus.ENDORSED;
    cheque.endorsedSupplierId =
      payment.partnerType === PaymentPartnerType.SUPPLIER ? payment.partnerId : (null as any);
    cheque.endorsementPaymentId = payment.id;
    cheque.statusDate = payment.date;
    this.pushHistory(cheque, payment.date, 'endorsed', userId, payment.paymentNumber);
    return this.chequeRepo.save(cheque);
  }

  private pushHistory(cheque: Cheque, date: string, action: string, userId: string, note?: string) {
    cheque.history = [...(cheque.history ?? []), { date, action, userId, ...(note ? { note } : {}) }];
  }

  private async suggestAllocations(
    tenantId: string,
    payment: Payment,
    available: number,
  ): Promise<PaymentAllocationDto[]> {
    const documents: OpenDocument[] = await this.openDocuments(tenantId, payment);
    const allocations: PaymentAllocationDto[] = [];
    let remaining = available;
    for (const doc of documents) {
      if (remaining <= 0) break;
      const amount = Math.min(residual(doc.totalAmount, doc.paidAmount), remaining);
      if (amount > 0) {
        allocations.push({ invoiceId: doc.id, amount: round(amount, 4) });
        remaining = round(remaining - amount, 4);
      }
    }
    return allocations;
  }

  private async applyAllocations(
    tenantId: string,
    userId: string,
    payment: Payment,
    allocations: PaymentAllocationDto[],
  ): Promise<void> {
    const total = round(
      allocations.reduce((sum, a) => sum + Number(a.amount), 0),
      4,
    );
    const unallocated = round(settledAmount(payment) - Number(payment.allocatedAmount), 4);
    if (total > unallocated + 0.0001) {
      throw new BadRequestException(
        `Allocations (${total}) exceed the unallocated payment amount (${unallocated})`,
      );
    }

    const invoiceType =
      payment.partnerType === PaymentPartnerType.CUSTOMER ? 'sales_invoice' : 'purchase_invoice';
    const expected = await this.openDocuments(tenantId, payment);
    const openIds = new Set(expected.map((d) => d.id));

    for (const allocation of allocations) {
      if (!openIds.has(allocation.invoiceId)) {
        throw new BadRequestException(
          `Document ${allocation.invoiceId} is not an open ${invoiceType.replace('_', ' ')} of this partner that this payment can settle`,
        );
      }
      const document = await this.loadDocument(tenantId, payment, allocation.invoiceId);
      if (payment.currencyId && document.currencyId && payment.currencyId !== document.currencyId) {
        throw new BadRequestException(
          `Document ${allocation.invoiceId} is in another currency than the payment`,
        );
      }
      const amount = round(allocation.amount, 4);
      await this.applyToDocument(payment, document, amount);
      await this.allocationRepo.save(
        this.allocationRepo.create({
          paymentId: payment.id,
          invoiceType,
          invoiceId: allocation.invoiceId,
          amount,
        }),
      );
      await this.postExchangeDifference(tenantId, userId, payment, document, amount);
    }

    payment.allocatedAmount = round(Number(payment.allocatedAmount) + total, 4);
    await this.paymentRepo.update(payment.id, { allocatedAmount: payment.allocatedAmount });
  }

  /**
   * Posts the realised FX gain/loss of settling `amount` of a document booked
   * at a different rate. The partner account is corrected to the booked
   * value; posted in base currency under the payment so cancelling reverses it.
   */
  private async postExchangeDifference(
    tenantId: string,
    userId: string,
    payment: Payment,
    document: OpenDocument,
    amount: number,
  ) {
    const paymentRate = Number(payment.exchangeRate ?? 1) || 1;
    const documentRate = Number(document.exchangeRate ?? 1) || 1;
    if (paymentRate === documentRate) return;
    const inbound = payment.direction === PaymentDirection.INBOUND;
    const difference = PaymentsService.exchangeDifference(
      inbound,
      amount,
      paymentRate,
      documentRate,
    );
    if (difference === 0) return;

    const partnerKey: SettingsAccountKey =
      payment.partnerType === PaymentPartnerType.CUSTOMER
        ? 'receivableAccountId'
        : 'payableAccountId';
    const date = document.date > payment.date ? document.date : payment.date;
    const value = Math.abs(difference);

    await this.autoPosting.post({
      tenantId,
      userId,
      journalType: JournalType.GENERAL,
      date,
      description: `Exchange difference ${payment.paymentNumber} / ${
        (document as SalesInvoice).invoiceNumber ?? document.id
      }`,
      sourceType: 'payment',
      sourceId: payment.id,
      buildLines: (_s, account) => {
        const partner = account(partnerKey);
        // A gain means the partner account was over-credited (money in at a
        // higher rate) or under-debited (money out at a lower rate): debit
        // it back. A loss is the mirror image.
        return difference > 0
          ? [
              { accountId: account('fxGainAccountId'), credit: value },
              { accountId: partner, debit: value },
            ]
          : [
              { accountId: account('fxLossAccountId'), debit: value },
              { accountId: partner, credit: value },
            ];
      },
    });
  }

  private async loadDocument(
    tenantId: string,
    payment: Payment,
    id: string,
  ): Promise<OpenDocument> {
    const document =
      payment.partnerType === PaymentPartnerType.CUSTOMER
        ? await this.salesInvoiceRepo.findOne({ where: { id, tenantId } })
        : await this.purchaseInvoiceRepo.findOne({ where: { id, tenantId } });
    if (!document) throw new NotFoundException(`Invoice ${id} not found`);
    return document;
  }

  private applyToDocument(payment: Payment, document: OpenDocument, amount: number) {
    return payment.partnerType === PaymentPartnerType.CUSTOMER
      ? this.salesInvoices.applyPayment(document as SalesInvoice, amount)
      : this.purchaseInvoices.applyPayment(document as PurchaseInvoice, amount);
  }

  /** Settings accounts the payment posting will need (for the preflight check). */
  private requiredAccounts(
    payment: Payment,
    treasury: Treasury | null,
    endorsement: boolean,
  ): SettingsAccountKey[] {
    const keys: SettingsAccountKey[] = [
      payment.partnerType === PaymentPartnerType.CUSTOMER
        ? 'receivableAccountId'
        : 'payableAccountId',
    ];
    const liquidity = this.liquidityKey(payment, treasury, endorsement);
    if (liquidity) keys.push(liquidity);
    if (Number(payment.withholdingAmount) > 0) {
      keys.push(
        payment.partnerType === PaymentPartnerType.CUSTOMER
          ? 'withholdingTaxReceivableAccountId'
          : 'withholdingTaxPayableAccountId',
      );
    }
    if (Number(payment.discountAllowed) > 0) {
      keys.push(PaymentsService.discountKey(payment.partnerType));
    }
    return keys;
  }

  /** Discount allowed to customers / received from suppliers on settlement. */
  static discountKey(partnerType: PaymentPartnerType): SettingsAccountKey {
    return partnerType === PaymentPartnerType.CUSTOMER
      ? 'salesDiscountAccountId'
      : 'purchaseDiscountAccountId';
  }

  /** Settings key of the money-side account, or null when the treasury's own account is used. */
  private liquidityKey(
    payment: Payment,
    treasury: Treasury | null,
    endorsement: boolean,
  ): SettingsAccountKey | null {
    if (payment.method === PaymentMethod.CHEQUE) {
      if (payment.direction === PaymentDirection.INBOUND || endorsement) {
        return 'notesReceivableAccountId';
      }
      return 'notesPayableAccountId';
    }
    if (treasury) return null;
    return payment.method === PaymentMethod.CASH ? 'cashAccountId' : 'bankAccountId';
  }

  private async postJournal(
    tenantId: string,
    userId: string,
    payment: Payment,
    treasury: Treasury | null,
    endorsement: boolean,
  ) {
    const amount = Number(payment.amount);
    const withheld = Number(payment.withholdingAmount || 0);
    const discount = Number(payment.discountAllowed || 0);
    const gross = round(amount + withheld + discount, 4);
    const isCustomer = payment.partnerType === PaymentPartnerType.CUSTOMER;
    const inbound = payment.direction === PaymentDirection.INBOUND;
    const liquidityKey = this.liquidityKey(payment, treasury, endorsement);
    const isCash =
      payment.method !== PaymentMethod.CHEQUE &&
      (treasury ? treasury.type === TreasuryType.CASH : payment.method === PaymentMethod.CASH);

    await this.autoPosting.post({
      tenantId,
      userId,
      journalType: isCash ? JournalType.CASH : JournalType.BANK,
      date: payment.date,
      description: `Payment ${payment.paymentNumber}${payment.reference ? ` (${payment.reference})` : ''}`,
      sourceType: 'payment',
      sourceId: payment.id,
      currencyId: payment.currencyId,
      exchangeRate: Number(payment.exchangeRate ?? 1) || 1,
      buildLines: (_s, account) => {
        const liquidity = liquidityKey ? account(liquidityKey) : treasury!.accountId;
        const counterpart = account(isCustomer ? 'receivableAccountId' : 'payableAccountId');
        const branchId = treasury?.branchId ?? undefined;
        if (inbound) {
          const lines: PostingLine[] = [{ accountId: liquidity, debit: amount, branchId }];
          if (withheld > 0) {
            lines.push({ accountId: account('withholdingTaxReceivableAccountId'), debit: withheld });
          }
          if (discount > 0) {
            lines.push({ accountId: account(PaymentsService.discountKey(payment.partnerType)), debit: discount });
          }
          lines.push({ accountId: counterpart, credit: gross });
          return lines;
        }
        const lines: PostingLine[] = [{ accountId: counterpart, debit: gross }];
        lines.push({ accountId: liquidity, credit: amount, branchId });
        if (withheld > 0) {
          lines.push({ accountId: account('withholdingTaxPayableAccountId'), credit: withheld });
        }
        if (discount > 0) {
          lines.push({ accountId: account(PaymentsService.discountKey(payment.partnerType)), credit: discount });
        }
        return lines;
      },
    });
  }

  /**
   * sign = -1 when posting, +1 when cancelling. A customer receipt or a
   * vendor payment lowers the outstanding balance (by the gross amount,
   * withholding included); refunds raise it.
   */
  private async adjustPartnerBalance(tenantId: string, payment: Payment, sign: 1 | -1) {
    const amount = settledAmount(payment);
    if (payment.partnerType === PaymentPartnerType.CUSTOMER) {
      const settles = payment.direction === PaymentDirection.INBOUND;
      await this.salesInvoices.adjustCustomerBalance(
        tenantId,
        payment.partnerId,
        (settles ? 1 : -1) * sign * amount,
      );
    } else {
      const settles = payment.direction === PaymentDirection.OUTBOUND;
      await this.purchaseInvoices.adjustSupplierBalance(
        tenantId,
        payment.partnerId,
        (settles ? 1 : -1) * sign * amount,
      );
    }
  }
}
