import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import {
  PurchaseInvoice,
  PurchaseInvoiceStatus,
  PurchaseInvoiceType,
} from '../entities/purchase-invoice.entity';
import { PurchaseInvoiceLine } from '../entities/purchase-invoice-line.entity';
import { Supplier } from '../entities/supplier.entity';
import { CreatePurchaseInvoiceDto } from '../dto/create-purchase-invoice.dto';
import { CreateVendorRefundDto } from '../dto/purchase-actions.dto';
import { Product, ProductType } from '@modules/inventory/entities/product.entity';
import { SequenceService } from '@shared/services/sequence.service';
import { AutoPostingService, PostingLine } from '@modules/accounting/services/auto-posting.service';
import { JournalType } from '@modules/accounting/entities/journal.entity';
import {
  addDays,
  computeLine,
  computeTotals,
  computeWithholding,
  paymentState,
  residual,
  round,
  today,
  withDefaultTaxRates,
} from '@shared/utils/document-totals.util';

const OPEN_STATUSES = [
  PurchaseInvoiceStatus.APPROVED,
  PurchaseInvoiceStatus.PARTIAL,
  PurchaseInvoiceStatus.OVERDUE,
];

@Injectable()
export class PurchaseInvoicesService {
  constructor(
    @InjectRepository(PurchaseInvoice)
    private readonly invoiceRepo: Repository<PurchaseInvoice>,
    @InjectRepository(PurchaseInvoiceLine)
    private readonly lineRepo: Repository<PurchaseInvoiceLine>,
    @InjectRepository(Supplier)
    private readonly supplierRepo: Repository<Supplier>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    private readonly sequenceService: SequenceService,
    private readonly autoPosting: AutoPostingService,
  ) {}

  /** Creates a draft vendor bill. Amounts are always recomputed from the lines. */
  async create(
    tenantId: string,
    userId: string,
    dto: CreatePurchaseInvoiceDto,
    extra: Partial<PurchaseInvoice> = {},
  ): Promise<PurchaseInvoice> {
    const supplier = await this.getSupplier(tenantId, dto.supplierId);

    if (dto.supplierReference && extra.moveType !== PurchaseInvoiceType.REFUND) {
      const duplicate = await this.invoiceRepo.findOne({
        where: {
          tenantId,
          supplierId: dto.supplierId,
          supplierReference: dto.supplierReference,
          moveType: PurchaseInvoiceType.BILL,
          status: Not(PurchaseInvoiceStatus.CANCELLED),
        },
      });
      if (duplicate) {
        throw new ConflictException(
          `Vendor reference ${dto.supplierReference} is already used on bill ${duplicate.invoiceNumber}`,
        );
      }
    }

    const taxIncluded = !!dto.pricesIncludeTax;
    const inputLines = await this.withPurchaseTaxDefaults(tenantId, dto.lines);
    const lines = inputLines.map((l) => ({
      ...computeLine(l, { taxIncluded }),
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

    const isRefund = extra.moveType === PurchaseInvoiceType.REFUND;
    const invoiceNumber = isRefund
      ? await this.sequenceService.next(tenantId, 'purchase_refund', 'RBILL')
      : await this.sequenceService.next(tenantId, 'purchase_invoice', 'PINV');

    const { subtotal: _s, taxAmount: _t, totalAmount: _a, ...header } = dto;
    const invoice = this.invoiceRepo.create({
      ...header,
      ...extra,
      tenantId,
      invoiceNumber,
      createdBy: userId,
      status: PurchaseInvoiceStatus.DRAFT,
      dueDate: dto.dueDate || addDays(dto.date, supplier.paymentTermDays || 0),
      paidAmount: 0,
      pricesIncludeTax: taxIncluded,
      withholdingRate: Number(dto.withholdingRate ?? 0),
      withholdingAmount,
      ...totals,
      lines: lines.map(({ taxAmount: _t, ...l }) => this.lineRepo.create(l)),
    });

    return this.invoiceRepo.save(invoice);
  }

  async findAll(tenantId: string): Promise<PurchaseInvoice[]> {
    return this.invoiceRepo.find({
      where: { tenantId },
      relations: ['lines', 'supplier'],
      order: { createdAt: 'DESC' },
    });
  }

  async findById(tenantId: string, id: string): Promise<PurchaseInvoice> {
    const invoice = await this.invoiceRepo.findOne({
      where: { id, tenantId },
      relations: ['lines', 'supplier'],
    });
    if (!invoice) throw new NotFoundException('Purchase invoice not found');
    return invoice;
  }

  /**
   * Validates a draft bill or refund: posts the journal entry (stockable
   * goods to inventory, services/consumables to expense, input VAT) and
   * updates the supplier payable balance.
   */
  async approve(tenantId: string, id: string, userId?: string): Promise<PurchaseInvoice> {
    const invoice = await this.findById(tenantId, id);

    if (invoice.status !== PurchaseInvoiceStatus.DRAFT) {
      throw new ConflictException('Only draft invoices can be approved');
    }

    const isRefund = invoice.moveType === PurchaseInvoiceType.REFUND;
    const actor = userId ?? invoice.createdBy;
    const products = await this.productRepo.find({
      where: { tenantId, id: In([...new Set(invoice.lines.map((l) => l.productId))]) },
    });
    const productType = new Map(products.map((p) => [p.id, p.type]));
    const total = Number(invoice.totalAmount);
    const tax = Number(invoice.taxAmount);

    await this.autoPosting.post({
      tenantId,
      userId: actor,
      journalType: JournalType.PURCHASE,
      date: invoice.date,
      description: `${isRefund ? 'Vendor refund' : 'Vendor bill'} ${invoice.invoiceNumber}`,
      sourceType: 'purchase_invoice',
      sourceId: invoice.id,
      currencyId: invoice.currencyId,
      exchangeRate: Number(invoice.exchangeRate),
      buildLines: (s, account) => {
        // Refunds of services / consumables go to the purchase return account when configured.
        const expenseAccount = () =>
          isRefund && s.purchaseReturnAccountId
            ? s.purchaseReturnAccountId
            : account('purchaseAccountId');
        const expenseLines: PostingLine[] = invoice.lines.map((line) => ({
          accountId:
            productType.get(line.productId) === ProductType.GOODS
              ? account('inventoryAccountId')
              : expenseAccount(),
          [isRefund ? 'credit' : 'debit']: Number(line.lineTotal),
        }));
        return [
          ...expenseLines,
          { accountId: account('inputTaxAccountId'), [isRefund ? 'credit' : 'debit']: tax },
          { accountId: account('payableAccountId'), [isRefund ? 'debit' : 'credit']: total },
        ];
      },
    });

    await this.adjustSupplierBalance(tenantId, invoice.supplierId, isRefund ? -total : total);

    invoice.status = PurchaseInvoiceStatus.APPROVED;
    invoice.postedAt = new Date();
    const saved = await this.invoiceRepo.save(invoice);

    if (isRefund && invoice.reversedInvoiceId) {
      const original = await this.findById(tenantId, invoice.reversedInvoiceId);
      const amount = Math.min(residual(original.totalAmount, original.paidAmount), total);
      if (amount > 0 && OPEN_STATUSES.includes(original.status)) {
        await this.applyPayment(original, amount);
        await this.applyPayment(saved, amount);
      }
    }

    return saved;
  }

  /** Legacy "mark paid": pays the full residual from the cash journal. */
  async markPaid(tenantId: string, id: string, userId?: string): Promise<PurchaseInvoice> {
    const invoice = await this.findById(tenantId, id);

    if (!OPEN_STATUSES.includes(invoice.status)) {
      throw new ConflictException('Only approved or partial invoices can be marked as paid');
    }
    if (invoice.moveType === PurchaseInvoiceType.REFUND) {
      throw new ConflictException('Vendor refunds are settled through incoming payments');
    }

    const amount = residual(invoice.totalAmount, invoice.paidAmount);
    await this.autoPosting.post({
      tenantId,
      userId: userId ?? invoice.createdBy,
      journalType: JournalType.CASH,
      date: today(),
      description: `Payment of ${invoice.invoiceNumber}`,
      sourceType: 'purchase_invoice_payment',
      sourceId: invoice.id,
      buildLines: (_s, account) => [
        { accountId: account('payableAccountId'), debit: amount },
        { accountId: account('cashAccountId'), credit: amount },
      ],
    });
    await this.adjustSupplierBalance(tenantId, invoice.supplierId, -amount);

    return this.applyPayment(invoice, amount);
  }

  async applyPayment(invoice: PurchaseInvoice, amount: number): Promise<PurchaseInvoice> {
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
        ? PurchaseInvoiceStatus.PAID
        : state === 'partial'
          ? PurchaseInvoiceStatus.PARTIAL
          : PurchaseInvoiceStatus.APPROVED;
    return this.invoiceRepo.save(invoice);
  }

  async cancel(tenantId: string, userId: string, id: string): Promise<PurchaseInvoice> {
    const invoice = await this.findById(tenantId, id);
    if (invoice.status === PurchaseInvoiceStatus.CANCELLED) {
      throw new ConflictException('Invoice is already cancelled');
    }
    if (Number(invoice.paidAmount) > 0) {
      throw new ConflictException(
        'Bills with payments or refunds cannot be cancelled; issue a vendor refund instead',
      );
    }

    if (invoice.status !== PurchaseInvoiceStatus.DRAFT) {
      const isRefund = invoice.moveType === PurchaseInvoiceType.REFUND;
      await this.autoPosting.reverseSource(tenantId, userId, 'purchase_invoice', invoice.id);
      await this.adjustSupplierBalance(
        tenantId,
        invoice.supplierId,
        isRefund ? Number(invoice.totalAmount) : -Number(invoice.totalAmount),
      );
    }

    invoice.status = PurchaseInvoiceStatus.CANCELLED;
    return this.invoiceRepo.save(invoice);
  }

  /** Issues a (full or partial) vendor refund / debit note for a posted bill. */
  async createRefund(
    tenantId: string,
    userId: string,
    id: string,
    dto: CreateVendorRefundDto,
  ): Promise<PurchaseInvoice> {
    const original = await this.findById(tenantId, id);
    if (original.moveType === PurchaseInvoiceType.REFUND) {
      throw new BadRequestException('Cannot refund a vendor refund');
    }
    if (original.status === PurchaseInvoiceStatus.DRAFT || original.status === PurchaseInvoiceStatus.CANCELLED) {
      throw new ConflictException('Refunds can only be issued for approved bills');
    }

    const requested = new Map((dto.lines ?? []).map((l) => [l.invoiceLineId, l.quantity]));
    const lines = original.lines
      .map((line) => {
        const quantity = dto.lines ? requested.get(line.id) ?? 0 : Number(line.quantity);
        if (quantity > Number(line.quantity)) {
          throw new BadRequestException('Refunded quantity cannot exceed the billed quantity');
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
    if (lines.length === 0) throw new BadRequestException('Nothing to refund');

    const date = dto.date || today();
    const refund = await this.create(
      tenantId,
      userId,
      {
        supplierId: original.supplierId,
        date,
        dueDate: date,
        currencyId: original.currencyId,
        exchangeRate: Number(original.exchangeRate),
        branchId: original.branchId,
        notes: dto.reason ? `Refund of ${original.invoiceNumber}: ${dto.reason}` : `Refund of ${original.invoiceNumber}`,
        pricesIncludeTax: original.pricesIncludeTax,
        withholdingRate: Number(original.withholdingRate ?? 0),
        lines,
      },
      { moveType: PurchaseInvoiceType.REFUND, reversedInvoiceId: original.id },
    );

    return dto.post ? this.approve(tenantId, refund.id, userId) : refund;
  }

  async adjustSupplierBalance(tenantId: string, supplierId: string, delta: number): Promise<void> {
    if (!supplierId || !delta) return;
    await this.supplierRepo
      .createQueryBuilder()
      .update(Supplier)
      .set({ balance: () => `balance + (:delta)` })
      .setParameter('delta', round(delta, 4))
      .where('id = :id AND tenant_id = :tenantId', { id: supplierId, tenantId })
      .execute();
  }

  private async getSupplier(tenantId: string, supplierId: string): Promise<Supplier> {
    const supplier = await this.supplierRepo.findOne({ where: { id: supplierId, tenantId } });
    if (!supplier) throw new NotFoundException('Supplier not found');
    if (!supplier.isActive) throw new BadRequestException('Supplier is archived');
    return supplier;
  }

  /** Lines without a tax rate take the product's default purchase tax rate. */
  private async withPurchaseTaxDefaults<T extends { productId: string; taxRate?: number | null }>(
    tenantId: string,
    lines: T[],
  ): Promise<T[]> {
    const ids = lines.filter((l) => l.taxRate === undefined || l.taxRate === null).map((l) => l.productId);
    if (!ids.length) return lines;
    const products = await this.productRepo.find({ where: { tenantId, id: In([...new Set(ids)]) } });
    return withDefaultTaxRates(lines, new Map(products.map((p) => [p.id, Number(p.purchaseTaxRate ?? 0)])));
  }
}
