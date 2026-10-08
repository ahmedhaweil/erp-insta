import { Entity, Column, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { BaseEntity } from '@shared/entities/base.entity';
import { Customer } from './customer.entity';

export enum SalesReturnStatus {
  DRAFT = 'draft',
  POSTED = 'posted',
  CANCELLED = 'cancelled',
}

export enum ReturnRefundMethod {
  /** Credit note stays open on the customer account (or settles the original invoice). */
  CREDIT = 'credit',
  /** The customer is refunded in cash right away. */
  CASH = 'cash',
}

/**
 * Sales return. With `originalInvoiceId` the lines reference invoice lines
 * (prices come from the invoice); without it this is a cash/direct return
 * with explicit prices.
 */
@Entity('sales_returns')
export class SalesReturn extends TenantBaseEntity {
  @Column({ name: 'return_number' })
  returnNumber: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @Column({ name: 'original_invoice_id', type: 'uuid', nullable: true })
  originalInvoiceId: string | null;

  /** Warehouse the returned goods are put back into. */
  @Column({ name: 'warehouse_id', type: 'uuid', nullable: true })
  warehouseId: string | null;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'enum', enum: SalesReturnStatus, default: SalesReturnStatus.DRAFT })
  status: SalesReturnStatus;

  @Column({ name: 'refund_method', default: ReturnRefundMethod.CREDIT })
  refundMethod: ReturnRefundMethod;

  @Column({ nullable: true })
  reason: string;

  @Column({ name: 'prices_include_tax', default: false })
  pricesIncludeTax: boolean;

  @Column({ name: 'currency_id', type: 'uuid', nullable: true })
  currencyId: string | null;

  @Column({ name: 'exchange_rate', type: 'decimal', precision: 12, scale: 6, default: 1 })
  exchangeRate: number;

  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string | null;

  @Column({ name: 'sales_rep_id', type: 'uuid', nullable: true })
  salesRepId: string | null;

  @Column({ type: 'decimal', precision: 18, scale: 4, default: 0 })
  subtotal: number;

  @Column({ name: 'tax_amount', type: 'decimal', precision: 18, scale: 4, default: 0 })
  taxAmount: number;

  @Column({ name: 'total_amount', type: 'decimal', precision: 18, scale: 4, default: 0 })
  totalAmount: number;

  /** Cost of the restocked goods (Dr inventory / Cr COGS). */
  @Column({ name: 'cost_amount', type: 'decimal', precision: 18, scale: 4, default: 0 })
  costAmount: number;

  /** Credit note issued for the return. */
  @Column({ name: 'credit_note_id', type: 'uuid', nullable: true })
  creditNoteId: string | null;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @Column({ name: 'posted_at', type: 'timestamptz', nullable: true })
  postedAt: Date | null;

  @ManyToOne(() => Customer)
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  @OneToMany(() => SalesReturnLine, (line) => line.salesReturn, { cascade: true })
  lines: SalesReturnLine[];
}

@Entity('sales_return_lines')
export class SalesReturnLine extends BaseEntity {
  @Column({ name: 'return_id', type: 'uuid' })
  returnId: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ name: 'invoice_line_id', type: 'uuid', nullable: true })
  invoiceLineId: string | null;

  @Column({ type: 'decimal', precision: 18, scale: 4 })
  quantity: number;

  @Column({ name: 'unit_price', type: 'decimal', precision: 18, scale: 4 })
  unitPrice: number;

  @Column({ type: 'decimal', precision: 18, scale: 4, default: 0 })
  discount: number;

  @Column({ name: 'tax_rate', type: 'decimal', precision: 5, scale: 2, default: 0 })
  taxRate: number;

  @Column({ name: 'line_total', type: 'decimal', precision: 18, scale: 4 })
  lineTotal: number;

  /** Unit cost the goods are restocked at (cost when sold, else average cost). */
  @Column({ name: 'unit_cost', type: 'decimal', precision: 18, scale: 4, default: 0 })
  unitCost: number;

  /** False for damaged goods that are not put back into stock. */
  @Column({ default: true })
  restock: boolean;

  @Column({ nullable: true })
  description: string;

  @ManyToOne(() => SalesReturn, (r) => r.lines)
  @JoinColumn({ name: 'return_id' })
  salesReturn: SalesReturn;
}
