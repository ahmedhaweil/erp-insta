import { Entity, Column, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { Supplier } from './supplier.entity';
import { PurchaseInvoiceLine } from './purchase-invoice-line.entity';

export enum PurchaseInvoiceStatus {
  DRAFT = 'draft',
  APPROVED = 'approved',
  PAID = 'paid',
  PARTIAL = 'partial',
  OVERDUE = 'overdue',
  CANCELLED = 'cancelled',
}

export enum PurchaseInvoiceType {
  BILL = 'bill',
  REFUND = 'refund',
}

@Entity('purchase_invoices')
export class PurchaseInvoice extends TenantBaseEntity {
  @Column({ name: 'supplier_id', type: 'uuid' })
  supplierId: string;

  @Column({ name: 'invoice_number' })
  invoiceNumber: string;

  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ name: 'due_date', type: 'date' })
  dueDate: string;

  @Column({ type: 'enum', enum: PurchaseInvoiceStatus, default: PurchaseInvoiceStatus.DRAFT })
  status: PurchaseInvoiceStatus;

  @Column({ type: 'decimal', precision: 18, scale: 4 })
  subtotal: number;

  @Column({ name: 'tax_amount', type: 'decimal', precision: 18, scale: 4 })
  taxAmount: number;

  @Column({ name: 'total_amount', type: 'decimal', precision: 18, scale: 4 })
  totalAmount: number;

  @Column({ name: 'paid_amount', type: 'decimal', precision: 18, scale: 4, default: 0 })
  paidAmount: number;

  @Column({ name: 'currency_id', type: 'uuid', nullable: true })
  currencyId: string;

  @Column({ name: 'exchange_rate', type: 'decimal', precision: 12, scale: 6, default: 1 })
  exchangeRate: number;

  @Column({ nullable: true })
  notes: string;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string;

  @Column({ name: 'move_type', default: PurchaseInvoiceType.BILL })
  moveType: PurchaseInvoiceType;

  /** On a vendor refund: the bill it reverses. */
  @Column({ name: 'reversed_invoice_id', type: 'uuid', nullable: true })
  reversedInvoiceId: string;

  /** Vendor's own bill number, used to detect duplicate bills. */
  @Column({ name: 'supplier_reference', nullable: true })
  supplierReference: string;

  @Column({ name: 'posted_at', type: 'timestamptz', nullable: true })
  postedAt: Date;

  /** Unit prices include VAT (tax-inclusive pricing). */
  @Column({ name: 'prices_include_tax', default: false })
  pricesIncludeTax: boolean;

  /** Document withholding tax rate (%) applied to lines without their own rate. */
  @Column({ name: 'withholding_rate', type: 'decimal', precision: 5, scale: 2, default: 0 })
  withholdingRate: number;

  /**
   * Withholding tax we deduct from the vendor at payment (on untaxed
   * amounts). It does not reduce `totalAmount`; the payments module posts it
   * to withholdingTaxPayable when the bill is settled.
   */
  @Column({ name: 'withholding_amount', type: 'decimal', precision: 18, scale: 4, default: 0 })
  withholdingAmount: number;

  /** Purchase return that generated this vendor refund. */
  @Column({ name: 'purchase_return_id', type: 'uuid', nullable: true })
  purchaseReturnId: string | null;

  /** Opening balance document that created this open item (no lines, no own entry). */
  @Column({ name: 'opening_balance_id', type: 'uuid', nullable: true })
  openingBalanceId: string | null;

  @ManyToOne(() => Supplier)
  @JoinColumn({ name: 'supplier_id' })
  supplier: Supplier;

  @OneToMany(() => PurchaseInvoiceLine, (line) => line.invoice, { cascade: true })
  lines: PurchaseInvoiceLine[];
}
