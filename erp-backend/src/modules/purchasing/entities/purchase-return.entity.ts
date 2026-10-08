import { Entity, Column, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { BaseEntity } from '@shared/entities/base.entity';
import type { DocumentLot } from '@modules/inventory/services/document-lots.util';
import { Supplier } from './supplier.entity';

export enum PurchaseReturnStatus {
  DRAFT = 'draft',
  POSTED = 'posted',
  CANCELLED = 'cancelled',
}

export enum PurchaseReturnRefundMethod {
  /** Vendor refund (debit note) stays on the vendor account / settles the bill. */
  CREDIT = 'credit',
  /** The vendor pays the refund back in cash right away. */
  CASH = 'cash',
}

/**
 * Purchase return. With `originalBillId` the lines reference bill lines
 * (prices from the bill); without it this is a direct return with explicit
 * prices.
 */
@Entity('purchase_returns')
export class PurchaseReturn extends TenantBaseEntity {
  @Column({ name: 'return_number' })
  returnNumber: string;

  @Column({ name: 'supplier_id', type: 'uuid' })
  supplierId: string;

  @Column({ name: 'original_bill_id', type: 'uuid', nullable: true })
  originalBillId: string | null;

  /** Warehouse the goods leave from. */
  @Column({ name: 'warehouse_id', type: 'uuid', nullable: true })
  warehouseId: string | null;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'enum', enum: PurchaseReturnStatus, default: PurchaseReturnStatus.DRAFT })
  status: PurchaseReturnStatus;

  @Column({ name: 'refund_method', default: PurchaseReturnRefundMethod.CREDIT })
  refundMethod: PurchaseReturnRefundMethod;

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

  @Column({ type: 'decimal', precision: 18, scale: 4, default: 0 })
  subtotal: number;

  @Column({ name: 'tax_amount', type: 'decimal', precision: 18, scale: 4, default: 0 })
  taxAmount: number;

  @Column({ name: 'total_amount', type: 'decimal', precision: 18, scale: 4, default: 0 })
  totalAmount: number;

  /** Average cost of the goods taken out of stock. */
  @Column({ name: 'cost_amount', type: 'decimal', precision: 18, scale: 4, default: 0 })
  costAmount: number;

  /** Vendor refund (debit note) issued for the return. */
  @Column({ name: 'refund_id', type: 'uuid', nullable: true })
  refundId: string | null;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @Column({ name: 'posted_at', type: 'timestamptz', nullable: true })
  postedAt: Date | null;

  /** Part of the credit note / vendor refund reconciled with the original document when posted. */
  @Column({ name: 'applied_amount', type: 'decimal', precision: 18, scale: 4, default: 0 })
  appliedAmount: number;

  /** Cash refunded when posted (refund method cash). */
  @Column({ name: 'refunded_amount', type: 'decimal', precision: 18, scale: 4, default: 0 })
  refundedAmount: number;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @ManyToOne(() => Supplier)
  @JoinColumn({ name: 'supplier_id' })
  supplier: Supplier;

  @OneToMany(() => PurchaseReturnLine, (line) => line.purchaseReturn, { cascade: true })
  lines: PurchaseReturnLine[];
}

@Entity('purchase_return_lines')
export class PurchaseReturnLine extends BaseEntity {
  @Column({ name: 'return_id', type: 'uuid' })
  returnId: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ name: 'bill_line_id', type: 'uuid', nullable: true })
  billLineId: string | null;

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

  /** Average cost the goods left stock at. */
  @Column({ name: 'unit_cost', type: 'decimal', precision: 18, scale: 4, default: 0 })
  unitCost: number;

  /** False when the goods are not physically taken out of stock (e.g. price claim). */
  @Column({ default: true })
  restock: boolean;

  @Column({ nullable: true })
  description: string;

  /** Alternate unit the quantity and unit price are expressed in (null = base unit). */
  @Column({ name: 'unit_id', type: 'uuid', nullable: true })
  unitId: string | null;

  /** Base units per line unit (1 for the base unit); stock moves use quantity x factor. */
  @Column({ name: 'unit_factor', type: 'decimal', precision: 18, scale: 6, default: 1 })
  unitFactor: number;

  /** Lots/serial numbers moved by the return (base unit). */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  lots: DocumentLot[];

  @ManyToOne(() => PurchaseReturn, (r) => r.lines)
  @JoinColumn({ name: 'return_id' })
  purchaseReturn: PurchaseReturn;
}
