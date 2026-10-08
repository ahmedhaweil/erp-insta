import { Entity, Column, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { BaseEntity } from '@shared/entities/base.entity';

export enum PurchaseRequisitionStatus {
  DRAFT = 'draft',
  SUBMITTED = 'submitted',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  CONVERTED = 'converted',
  CANCELLED = 'cancelled',
}

/** Internal purchase request from a department, converted into RFQs. */
@Entity('purchase_requisitions')
export class PurchaseRequisition extends TenantBaseEntity {
  @Column({ name: 'requisition_number' })
  requisitionNumber: string;

  @Column({ name: 'department_id', type: 'uuid', nullable: true })
  departmentId: string | null;

  /** Requesting department name (free text when no department master exists). */
  @Column({ name: 'department_name', type: 'varchar', nullable: true })
  departmentName: string | null;

  @Column({ name: 'requested_by', type: 'uuid' })
  requestedBy: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ name: 'required_date', type: 'date', nullable: true })
  requiredDate: string | null;

  @Column({
    type: 'enum',
    enum: PurchaseRequisitionStatus,
    default: PurchaseRequisitionStatus.DRAFT,
  })
  status: PurchaseRequisitionStatus;

  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string | null;

  /** Warehouse the goods are needed in (copied to the RFQs). */
  @Column({ name: 'warehouse_id', type: 'uuid', nullable: true })
  warehouseId: string | null;

  @Column({ nullable: true })
  notes: string;

  @Column({ name: 'approved_by', type: 'uuid', nullable: true })
  approvedBy: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'rejection_reason', type: 'varchar', nullable: true })
  rejectionReason: string | null;

  /** RFQs generated from the requisition. */
  @Column({ name: 'purchase_order_ids', type: 'jsonb', default: () => "'[]'" })
  purchaseOrderIds: string[];

  @OneToMany(() => PurchaseRequisitionLine, (l) => l.requisition, { cascade: true })
  lines: PurchaseRequisitionLine[];
}

@Entity('purchase_requisition_lines')
export class PurchaseRequisitionLine extends BaseEntity {
  @Column({ name: 'requisition_id', type: 'uuid' })
  requisitionId: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ type: 'decimal', precision: 18, scale: 4 })
  quantity: number;

  /** Estimated unit price (defaults the RFQ price; else product cost). */
  @Column({ name: 'estimated_price', type: 'decimal', precision: 18, scale: 4, nullable: true })
  estimatedPrice: number | null;

  /** Suggested vendor (else the product preferred supplier). */
  @Column({ name: 'supplier_id', type: 'uuid', nullable: true })
  supplierId: string | null;

  @Column({ nullable: true })
  description: string;

  @Column({ name: 'purchase_order_id', type: 'uuid', nullable: true })
  purchaseOrderId: string | null;

  @ManyToOne(() => PurchaseRequisition, (r) => r.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'requisition_id' })
  requisition: PurchaseRequisition;
}
