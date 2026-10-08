import { Entity, Column } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

export enum LandedCostStatus {
  DRAFT = 'draft',
  POSTED = 'posted',
  CANCELLED = 'cancelled',
}

export enum LandedCostSplit {
  BY_VALUE = 'by_value',
  BY_QUANTITY = 'by_quantity',
  EQUAL = 'equal',
}

export interface LandedCostCharge {
  description: string;
  amount: number;
  /** Account credited (freight/customs clearing, the expense account a service bill hit, payable...). */
  accountId?: string;
}

export interface LandedCostAllocation {
  productId: string;
  receivedQty: number;
  receivedValue: number;
  share: number;
  amount: number;
  /** Part capitalised into stock still on hand; the rest went to cost of goods sold. */
  inventoryAmount: number;
  cogsAmount: number;
}

/**
 * Additional costs of purchased goods (freight, customs, clearance,
 * insurance) spread over the goods received on one or more purchase orders
 * (Odoo stock.landed.cost on average costing).
 */
@Entity('landed_costs')
export class LandedCost extends TenantBaseEntity {
  @Column()
  number: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'enum', enum: LandedCostStatus, default: LandedCostStatus.DRAFT })
  status: LandedCostStatus;

  @Column({ name: 'split_method', type: 'enum', enum: LandedCostSplit, default: LandedCostSplit.BY_VALUE })
  splitMethod: LandedCostSplit;

  @Column({ name: 'purchase_order_ids', type: 'uuid', array: true })
  purchaseOrderIds: string[];

  @Column({ type: 'jsonb' })
  charges: LandedCostCharge[];

  @Column({ name: 'total_amount', type: 'decimal', precision: 18, scale: 4, default: 0 })
  totalAmount: number;

  @Column({ type: 'jsonb', nullable: true })
  allocations: LandedCostAllocation[] | null;

  @Column({ nullable: true })
  notes: string;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @Column({ name: 'posted_at', type: 'timestamptz', nullable: true })
  postedAt: Date | null;
}
