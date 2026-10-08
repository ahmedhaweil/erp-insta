import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  SalesInvoice,
  SalesInvoiceStatus,
  SalesInvoiceType,
} from '../entities/sales-invoice.entity';
import { SalesInvoiceLine } from '../entities/sales-invoice-line.entity';
import { Customer } from '../entities/customer.entity';
import { CreateSalesInvoiceDto } from '../dto/create-sales-invoice.dto';
import { CreateCreditNoteDto } from '../dto/sales-actions.dto';
import { SequenceService } from '@shared/services/sequence.service';
import { AutoPostingService } from '@modules/accounting/services/auto-posting.service';
import { JournalType } from '@modules/accounting/entities/journal.entity';
import { SalesPricingService } from './sales-pricing.service';
import { InstallmentScheduleService } from './installment-schedule.service';
import {
  addDays,
  computeLine,
  computeTotals,
  computeWithholding,
  paymentState,
  residual,
  round,
  today,
} from '@shared/utils/document-totals.util';

const OPEN_STATUSES = [
  SalesInvoiceStatus.POSTED,
  SalesInvoiceStatus.SENT,
  SalesInvoiceStatus.PARTIAL,
  SalesInvoiceStatus.OVERDUE,
];

export interface InvoiceLineInput {
  productId: string;
  quantity: number;
  unitPrice?: number;
  discount?: number;
  taxRate?: number;
  description?: string;
  orderLineId?: string;
  withholdingRate?: number | null;
}

export interface CreateInvoiceOptions {
  /**
   * Skip price list pricing and the minimum selling price check (documents
   * derived from an already validated order, credit notes and returns).
   */
  skipPriceChecks?: boolean;
}

@Injectable()
export class SalesInvoicesService {
  constructor(
    @InjectRepository(SalesInvoice)
    private readonly invoiceRepo: Repository<SalesInvoice>,
    @InjectRepository(SalesInvoiceLine)
    private readonly lineRepo: Repository<SalesInvoiceLine>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    private readonly sequenceService: SequenceService,
    private readonly autoPosting: AutoPostingService,
    @Optional() private readonly pricing?: SalesPricingService,
    @Optional() private readonly installments?: InstallmentScheduleService,
  ) {}

  /**
   * Creates a draft invoice. Amounts are always recomputed from the lines;
   * lines without a unit price are priced from the customer price list.
   */
  async create(
    tenantId: string,
    userId: string,
    dto: CreateSalesInvoiceDto,
    extra: Partial<SalesInvoice> = {},
    options: CreateInvoiceOptions = {},
  ): Promise<SalesInvoice> {
    const customer = await this.getCustomer(tenantId, dto.customerId);
    const isCreditNote = extra.moveType === SalesInvoiceType.CREDIT_NOTE;
    const checkPrices = !isCreditNote && !options.skipPriceChecks;

    let inputLines: InvoiceLineInput[] = dto.lines;
    let priceListId: string | null = dto.priceListId ?? null;
    if (this.pricing && inputLines.some((l) => l.unitPrice === undefined || l.unitPrice === null)) {
      const priced = await this.pricing.priceLines(
        tenantId,
        { customer, priceListId: dto.priceListId, date: dto.date },
        inputLines,
      );
      inputLines = priced.lines;
      priceListId = priced.priceListId;
    }
    if (inputLines.some((l) => l.unitPrice === undefined || l.unitPrice === null)) {
      throw new BadRequestException('Every line needs a unit price');
    }

    const taxIncluded = !!dto.pricesIncludeTax;
    const lines = inputLines.map((l) => ({
      ...computeLine(l as InvoiceLineInput & { unitPrice: number }, { taxIncluded }),
      productId: l.productId,
      description: l.description,
      orderLineId: l.orderLineId,
      withholdingRate:
        l.withholdingRate === undefined || l.withholdingRate === null
          ? null
          : Number(l.withholdingRate),
    }));
    const totals = computeTotals(lines);
    const withholdingAmount = computeWithholding(lines, dto.withholdingRate);

    if (checkPrices && this.pricing) {
      await this.pricing.enforceMinPrice(
        tenantId,
        userId,
        lines.filter((l) => !l.orderLineId),
        Number(dto.exchangeRate ?? 1),
      );
    }

    const invoiceNumber = isCreditNote
      ? await this.sequenceService.next(tenantId, 'sales_credit_note', 'RINV')
      : await this.sequenceService.next(tenantId, 'sales_invoice', 'INV');

    const invoice = this.invoiceRepo.create({
      ...dto,
      ...extra,
      tenantId,
      invoiceNumber,
      createdBy: userId,
      status: SalesInvoiceStatus.DRAFT,
      dueDate: dto.dueDate || addDays(dto.date, customer.paymentTermDays || 0),
      paidAmount: 0,
      salesRepId: dto.salesRepId ?? extra.salesRepId ?? customer.salesRepId ?? null,
      priceListId,
      pricesIncludeTax: taxIncluded,
      withholdingRate: Number(dto.withholdingRate ?? 0),
      withholdingAmount,
      ...totals,
      lines: lines.map(({ taxAmount: _t, ...l }) => this.lineRepo.create(l)),
    });

    return this.invoiceRepo.save(invoice);
  }

  async findAll(tenantId: string): Promise<SalesInvoice[]> {
    return this.invoiceRepo.find({
      where: { tenantId },
      relations: ['lines', 'customer'],
      order: { createdAt: 'DESC' },
    });
  }

  async findById(tenantId: string, id: string): Promise<SalesInvoice> {
    const invoice = await this.invoiceRepo.findOne({
      where: { id, tenantId },
      relations: ['lines', 'customer'],
    });
    if (!invoice) throw new NotFoundException('Sales invoice not found');
    return invoice;
  }

  /**
   * Validates a draft invoice or credit note (Odoo "Confirm"): checks the
   * customer credit limit, posts the journal entry and updates the customer
   * receivable balance.
   */
  async post(tenantId: string, userId: string, id: string): Promise<SalesInvoice> {
    const invoice = await this.findById(tenantId, id);
    if (invoice.status !== SalesInvoiceStatus.DRAFT) {
      throw new ConflictException('Only draft invoices can be posted');
    }

    const isCreditNote = invoice.moveType === SalesInvoiceType.CREDIT_NOTE;
    const total = Number(invoice.totalAmount);
    const customer = await this.getCustomer(tenantId, invoice.customerId);

    if (!isCreditNote && Number(customer.creditLimit) > 0) {
      const newBalance = Number(customer.balance) + total;
      if (newBalance > Number(customer.creditLimit)) {
        throw new BadRequestException(
          `Credit limit exceeded. Limit: ${customer.creditLimit}, Current balance: ${customer.balance}, Invoice: ${total.toFixed(2)}`,
        );
      }
    }

    const subtotal = Number(invoice.subtotal);
    const tax = Number(invoice.taxAmount);
    await this.autoPosting.post({
      tenantId,
      userId,
      journalType: JournalType.SALE,
      date: invoice.date,
      description: `${isCreditNote ? 'Credit note' : 'Invoice'} ${invoice.invoiceNumber}`,
      sourceType: 'sales_invoice',
      sourceId: invoice.id,
      currencyId: invoice.currencyId,
      exchangeRate: Number(invoice.exchangeRate),
      buildLines: (s, account) =>
        isCreditNote
          ? [
              // Returns / allowances go to the sales return account when configured.
              { accountId: s.salesReturnAccountId || account('salesAccountId'), debit: subtotal },
              { accountId: account('outputTaxAccountId'), debit: tax },
              { accountId: account('receivableAccountId'), credit: total },
            ]
          : [
              { accountId: account('receivableAccountId'), debit: total },
              { accountId: account('salesAccountId'), credit: subtotal },
              { accountId: account('outputTaxAccountId'), credit: tax },
            ],
    });

    await this.adjustCustomerBalance(tenantId, invoice.customerId, isCreditNote ? -total : total);

    invoice.status = SalesInvoiceStatus.POSTED;
    invoice.postedAt = new Date();
    const saved = await this.invoiceRepo.save(invoice);

    // A credit note issued from an invoice is reconciled against it right away.
    if (isCreditNote && invoice.reversedInvoiceId) {
      const original = await this.findById(tenantId, invoice.reversedInvoiceId);
      const amount = Math.min(residual(original.totalAmount, original.paidAmount), total);
      if (amount > 0 && OPEN_STATUSES.includes(original.status)) {
        await this.applyPayment(original, amount);
        await this.applyPayment(saved, amount);
      }
    }

    return saved;
  }

  /**
   * Legacy "mark paid": registers a payment of the full residual amount in
   * the cash journal. Draft invoices are posted first.
   */
  async markPaid(tenantId: string, id: string, userId?: string): Promise<SalesInvoice> {
    let invoice = await this.findById(tenantId, id);

    if (invoice.status === SalesInvoiceStatus.PAID) {
      throw new ConflictException('Invoice is already fully paid');
    }

    if (invoice.status === SalesInvoiceStatus.CANCELLED) {
      throw new ConflictException('Cancelled invoices cannot be paid');
    }

    if (invoice.moveType === SalesInvoiceType.CREDIT_NOTE) {
      throw new ConflictException('Credit notes are settled through refunds, not payments');
    }

    const actor = userId ?? invoice.createdBy;
    await this.autoPosting.preflight(tenantId, today(), ['cashAccountId', 'receivableAccountId']);
    if (invoice.status === SalesInvoiceStatus.DRAFT) {
      await this.post(tenantId, actor, id);
      invoice = await this.findById(tenantId, id);
    }

    const amount = residual(invoice.totalAmount, invoice.paidAmount);
    await this.autoPosting.post({
      tenantId,
      userId: actor,
      journalType: JournalType.CASH,
      date: today(),
      description: `Payment of ${invoice.invoiceNumber}`,
      sourceType: 'sales_invoice_payment',
      sourceId: invoice.id,
      buildLines: (_s, account) => [
        { accountId: account('cashAccountId'), debit: amount },
        { accountId: account('receivableAccountId'), credit: amount },
      ],
    });
    await this.adjustCustomerBalance(tenantId, invoice.customerId, -amount);

    return this.applyPayment(invoice, amount);
  }

  /** Records a reconciled amount on an invoice and recomputes its status. */
  async applyPayment(invoice: SalesInvoice, amount: number): Promise<SalesInvoice> {
    const open = residual(invoice.totalAmount, invoice.paidAmount);
    if (amount > open + 0.0001) {
      throw new BadRequestException(
        `Amount ${amount} exceeds the residual ${open} of ${invoice.invoiceNumber}`,
      );
    }
    invoice.paidAmount = round(Number(invoice.paidAmount) + amount, 4);
    const state = paymentState(invoice.paidAmount, invoice.totalAmount);
    invoice.status =
      state === 'paid'
        ? SalesInvoiceStatus.PAID
        : state === 'partial'
          ? SalesInvoiceStatus.PARTIAL
          : SalesInvoiceStatus.POSTED;
    const saved = await this.invoiceRepo.save(invoice);
    // Payments applied to an installment invoice settle its installments by due date.
    if (this.installments && invoice.moveType !== SalesInvoiceType.CREDIT_NOTE) {
      await this.installments.syncInvoice(invoice.tenantId, invoice.id, Number(invoice.paidAmount));
    }
    return saved;
  }

  /**
   * Cancels a draft invoice, or a posted one without payments (its journal
   * entry is reversed and the customer balance restored).
   */
  async cancel(tenantId: string, userId: string, id: string): Promise<SalesInvoice> {
    const invoice = await this.findById(tenantId, id);
    if (invoice.status === SalesInvoiceStatus.CANCELLED) {
      throw new ConflictException('Invoice is already cancelled');
    }
    if (Number(invoice.paidAmount) > 0) {
      throw new ConflictException(
        'Invoices with payments or credit notes cannot be cancelled; issue a credit note instead',
      );
    }

    if (invoice.status !== SalesInvoiceStatus.DRAFT) {
      const isCreditNote = invoice.moveType === SalesInvoiceType.CREDIT_NOTE;
      await this.autoPosting.reverseSource(tenantId, userId, 'sales_invoice', invoice.id);
      await this.adjustCustomerBalance(
        tenantId,
        invoice.customerId,
        isCreditNote ? Number(invoice.totalAmount) : -Number(invoice.totalAmount),
      );
    }

    invoice.status = SalesInvoiceStatus.CANCELLED;
    return this.invoiceRepo.save(invoice);
  }

  /** Issues a (full or partial) credit note for a posted invoice (Odoo "Reverse"). */
  async createCreditNote(
    tenantId: string,
    userId: string,
    id: string,
    dto: CreateCreditNoteDto,
  ): Promise<SalesInvoice> {
    const original = await this.findById(tenantId, id);
    if (original.moveType === SalesInvoiceType.CREDIT_NOTE) {
      throw new BadRequestException('Cannot issue a credit note for a credit note');
    }
    if (original.status === SalesInvoiceStatus.DRAFT || original.status === SalesInvoiceStatus.CANCELLED) {
      throw new ConflictException('Credit notes can only be issued for posted invoices');
    }

    const requested = new Map((dto.lines ?? []).map((l) => [l.invoiceLineId, l.quantity]));
    const lines = original.lines
      .map((line) => {
        const quantity = dto.lines ? requested.get(line.id) ?? 0 : Number(line.quantity);
        if (quantity > Number(line.quantity)) {
          throw new BadRequestException('Credited quantity cannot exceed the invoiced quantity');
        }
        return {
          productId: line.productId,
          quantity,
          unitPrice: Number(line.unitPrice),
          discount: round((Number(line.discount) * quantity) / Number(line.quantity), 4),
          taxRate: Number(line.taxRate),
          description: line.description,
          withholdingRate: line.withholdingRate ?? undefined,
        };
      })
      .filter((l) => l.quantity > 0);
    if (lines.length === 0) throw new BadRequestException('Nothing to credit');

    const date = dto.date || today();
    const creditNote = await this.create(
      tenantId,
      userId,
      {
        customerId: original.customerId,
        date,
        dueDate: date,
        currencyId: original.currencyId,
        exchangeRate: Number(original.exchangeRate),
        branchId: original.branchId,
        notes: dto.reason ? `Credit note for ${original.invoiceNumber}: ${dto.reason}` : `Credit note for ${original.invoiceNumber}`,
        salesRepId: original.salesRepId ?? undefined,
        pricesIncludeTax: original.pricesIncludeTax,
        withholdingRate: Number(original.withholdingRate ?? 0),
        lines,
      },
      { moveType: SalesInvoiceType.CREDIT_NOTE, reversedInvoiceId: original.id },
      { skipPriceChecks: true },
    );

    return dto.post ? this.post(tenantId, userId, creditNote.id) : creditNote;
  }

  async adjustCustomerBalance(tenantId: string, customerId: string, delta: number): Promise<void> {
    if (!customerId || !delta) return;
    await this.customerRepo
      .createQueryBuilder()
      .update(Customer)
      .set({ balance: () => `balance + (:delta)` })
      .setParameter('delta', round(delta, 4))
      .where('id = :id AND tenant_id = :tenantId', { id: customerId, tenantId })
      .execute();
  }

  private async getCustomer(tenantId: string, customerId: string): Promise<Customer> {
    const customer = await this.customerRepo.findOne({ where: { id: customerId, tenantId } });
    if (!customer) throw new NotFoundException('Customer not found');
    if (!customer.isActive) throw new BadRequestException('Customer is archived');
    return customer;
  }
}
