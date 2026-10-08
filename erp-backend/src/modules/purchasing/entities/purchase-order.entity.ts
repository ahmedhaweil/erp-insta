import { Entity, Column, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { Supplier } from './supplier.entity';
import { PurchaseOrderLine } from './purchase-order-line.entity';

export enum PurchaseOrderBillStatus {
  NOTHING = 'nothing',
  TO_BILL = 'to_bill',
  PARTIAL = 'partial',
  BILLED = 'billed',
}

export enum PurchaseOrderStatus {
  DRAFT = 'draft',
  SENT = 'sent',
  /** Above the approval threshold, waiting for a purchasing/po_approval/approve user. */
  TO_APPROVE = 'to_approve',
  CONFIRMED = 'confirmed',
  RECEIVED = 'received',
  CANCELLED = 'cancelled',
}

@Entity('purchase_orders')
export class PurchaseOrder extends TenantBaseEntity {
  @Column({ name: 'supplier_id', type: 'uuid' })
  supplierId: string;

  @Column({ name: 'order_number' })
  orderNumber: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'enum', enum: PurchaseOrderStatus, default: PurchaseOrderStatus.DRAFT })
  status: PurchaseOrderStatus;

  @Column({ type: 'decimal', precision: 18, scale: 4 })
  subtotal: number;

  @Column({ name: 'tax_amount', type: 'decimal', precision: 18, scale: 4 })
  taxAmount: number;

  @Column({ name: 'total_amount', type: 'decimal', precision: 18, scale: 4 })
  totalAmount: number;

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

  /** Warehouse goods are received into. */
  @Column({ name: 'warehouse_id', type: 'uuid', nullable: true })
  warehouseId: string;

  @Column({ name: 'expected_date', type: 'date', nullable: true })
  expectedDate: string;

  @Column({ name: 'bill_status', default: PurchaseOrderBillStatus.NOTHING })
  billStatus: PurchaseOrderBillStatus;

  /** Unit prices include VAT (tax-inclusive pricing). */
  @Column({ name: 'prices_include_tax', default: false })
  pricesIncludeTax: boolean;

  @Column({ name: 'approved_by', type: 'uuid', nullable: true })
  approvedBy: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'rejection_reason', type: 'varchar', nullable: true })
  rejectionReason: string | null;

  /** Purchase requisition this RFQ was generated from. */
  @Column({ name: 'requisition_id', type: 'uuid', nullable: true })
  requisitionId: string | null;

  @ManyToOne(() => Supplier)
  @JoinColumn({ name: 'supplier_id' })
  supplier: Supplier;

  @OneToMany(() => PurchaseOrderLine, (line) => line.order, { cascade: true })
  lines: PurchaseOrderLine[];
}
