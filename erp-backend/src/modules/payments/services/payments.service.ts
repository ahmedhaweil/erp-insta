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
import { AutoPostingService } from '@modules/accounting/services/auto-posting.service';
import { JournalType } from '@modules/accounting/entities/journal.entity';
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

/**
 * Customer and vendor payments (Odoo account.payment) with partial payments,
 * reconciliation against invoices/bills, refunds of credit notes and
 * advances that stay unallocated until reconciled.
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
    private readonly salesInvoices: SalesInvoicesService,
    private readonly purchaseInvoices: PurchaseInvoicesService,
    private readonly autoPosting: AutoPostingService,
    private readonly sequenceService: SequenceService,
  ) {}

  findAll(tenantId: string, partnerId?: string): Promise<Payment[]> {
    const where: any = { tenantId };
    if (partnerId) where.partnerId = partnerId;
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
    const amount = round(dto.amount, 4);
    const method = dto.method ?? PaymentMethod.CASH;

    await this.autoPosting.preflight(tenantId, dto.date, [
      method === PaymentMethod.CASH ? 'cashAccountId' : 'bankAccountId',
      isCustomer ? 'receivableAccountId' : 'payableAccountId',
    ]);

    const paymentNumber = await this.sequenceService.next(
      tenantId,
      direction === PaymentDirection.INBOUND ? 'payment_in' : 'payment_out',
      direction === PaymentDirection.INBOUND ? 'PAY-IN' : 'PAY-OUT',
    );

    const payment = await this.paymentRepo.save(
      this.paymentRepo.create({
        tenantId,
        paymentNumber,
        partnerType: dto.partnerType,
        partnerId: dto.partnerId,
        direction,
        date: dto.date,
        amount,
        allocatedAmount: 0,
        method,
        reference: dto.reference,
        currencyId: dto.currencyId,
        status: PaymentStatus.POSTED,
        createdBy: userId,
      }),
    );

    await this.postJournal(tenantId, userId, payment);
    await this.adjustPartnerBalance(tenantId, payment, -1);

    const allocations = dto.allocations?.length
      ? dto.allocations
      : dto.autoAllocate
        ? await this.suggestAllocations(tenantId, payment, amount)
        : [];
    if (allocations.length) {
      await this.applyAllocations(tenantId, payment, allocations);
    }

    return this.findById(tenantId, payment.id);
  }

  /** Reconciles the unallocated part of a payment with open documents. */
  async allocate(tenantId: string, id: string, dto: AllocatePaymentDto): Promise<Payment> {
    const payment = await this.findById(tenantId, id);
    if (payment.status !== PaymentStatus.POSTED) {
      throw new ConflictException('Only posted payments can be allocated');
    }
    await this.applyAllocations(tenantId, payment, dto.allocations);
    return this.findById(tenantId, id);
  }

  /** Cancels a payment: reverses its journal entry and un-reconciles invoices. */
  async cancel(tenantId: string, userId: string, id: string): Promise<Payment> {
    const payment = await this.findById(tenantId, id);
    if (payment.status === PaymentStatus.CANCELLED) {
      throw new ConflictException('Payment is already cancelled');
    }

    for (const allocation of payment.allocations) {
      const document = await this.loadDocument(tenantId, payment, allocation.invoiceId);
      await this.applyToDocument(payment, document, -Number(allocation.amount));
    }
    await this.allocationRepo.delete({ paymentId: payment.id });

    await this.autoPosting.reverseSource(tenantId, userId, 'payment', payment.id);
    await this.adjustPartnerBalance(tenantId, payment, 1);

    payment.status = PaymentStatus.CANCELLED;
    payment.allocatedAmount = 0;
    payment.allocations = [];
    return this.paymentRepo.save(payment);
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
    payment: Payment,
    allocations: PaymentAllocationDto[],
  ): Promise<void> {
    const total = round(
      allocations.reduce((sum, a) => sum + Number(a.amount), 0),
      4,
    );
    const unallocated = round(Number(payment.amount) - Number(payment.allocatedAmount), 4);
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
      await this.applyToDocument(payment, document, round(allocation.amount, 4));
      await this.allocationRepo.save(
        this.allocationRepo.create({
          paymentId: payment.id,
          invoiceType,
          invoiceId: allocation.invoiceId,
          amount: round(allocation.amount, 4),
        }),
      );
    }

    payment.allocatedAmount = round(Number(payment.allocatedAmount) + total, 4);
    await this.paymentRepo.update(payment.id, { allocatedAmount: payment.allocatedAmount });
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

  private async postJournal(tenantId: string, userId: string, payment: Payment) {
    const amount = Number(payment.amount);
    const isCustomer = payment.partnerType === PaymentPartnerType.CUSTOMER;
    const inbound = payment.direction === PaymentDirection.INBOUND;
    const isCash = payment.method === PaymentMethod.CASH;

    await this.autoPosting.post({
      tenantId,
      userId,
      journalType: isCash ? JournalType.CASH : JournalType.BANK,
      date: payment.date,
      description: `Payment ${payment.paymentNumber}${payment.reference ? ` (${payment.reference})` : ''}`,
      sourceType: 'payment',
      sourceId: payment.id,
      currencyId: payment.currencyId,
      buildLines: (_s, account) => {
        const liquidity = account(isCash ? 'cashAccountId' : 'bankAccountId');
        const counterpart = account(isCustomer ? 'receivableAccountId' : 'payableAccountId');
        return inbound
          ? [
              { accountId: liquidity, debit: amount },
              { accountId: counterpart, credit: amount },
            ]
          : [
              { accountId: counterpart, debit: amount },
              { accountId: liquidity, credit: amount },
            ];
      },
    });
  }

  /**
   * sign = -1 when posting, +1 when cancelling. A customer receipt or a
   * vendor payment lowers the outstanding balance; refunds raise it.
   */
  private async adjustPartnerBalance(tenantId: string, payment: Payment, sign: 1 | -1) {
    const amount = Number(payment.amount);
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
