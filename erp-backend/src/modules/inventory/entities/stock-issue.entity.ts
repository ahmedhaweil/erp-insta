import { Entity, Column, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { BaseEntity } from '@shared/entities/base.entity';
import { Warehouse } from './warehouse.entity';
import { Product } from './product.entity';

/** Why goods leave stock without a sale (Instasoft item_damage / item_charity). */
export enum StockIssueType {
  DAMAGE = 'damage',
  DONATION = 'donation',
  INTERNAL_USE = 'internal_use',
  SAMPLE = 'sample',
}

export enum StockIssueStatus {
  DRAFT = 'draft',
  POSTED = 'posted',
  CANCELLED = 'cancelled',
}

export interface StockIssueLotQty {
  lotNumber: string;
  quantity: number;
  expiryDate?: string | null;
}

/**
 * Stock issue document (إذن صرف: تالف / تبرعات / استخدام داخلي / عينات):
 * goods issued at average cost and expensed (Dr expense / Cr inventory).
 */
@Entity('stock_issues')
export class StockIssue extends TenantBaseEntity {
  @Column({ name: 'issue_number' })
  issueNumber: string;

  @Column({ type: 'enum', enum: StockIssueType })
  type: StockIssueType;

  @Column({ type: 'date' })
  date: string;

  @Column({ name: 'warehouse_id', type: 'uuid' })
  warehouseId: string;

  @Column({ type: 'varchar', nullable: true })
  reason: string | null;

  /** Optional expense account overriding the default of the type. */
  @Column({ name: 'expense_account_id', type: 'uuid', nullable: true })
  expenseAccountId: string | null;

  /** Beneficiary of a donation / recipient of samples (free text). */
  @Column({ type: 'varchar', nullable: true })
  beneficiary: string | null;

  @Column({ type: 'enum', enum: StockIssueStatus, default: StockIssueStatus.DRAFT })
  status: StockIssueStatus;

  /** Cost of the goods issued (set on posting). */
  @Column({ name: 'total_cost', type: 'decimal', precision: 18, scale: 4, default: 0 })
  totalCost: number;

  @Column({ name: 'posted_at', type: 'timestamptz', nullable: true })
  postedAt: Date | null;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @ManyToOne(() => Warehouse)
  @JoinColumn({ name: 'warehouse_id' })
  warehouse: Warehouse;

  @OneToMany(() => StockIssueLine, (l) => l.issue, { cascade: true })
  lines: StockIssueLine[];
}

@Entity('stock_issue_lines')
export class StockIssueLine extends BaseEntity {
  @Column({ name: 'issue_id', type: 'uuid' })
  issueId: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  /** Quantity in base unit. */
  @Column({ type: 'decimal', precision: 18, scale: 4 })
  quantity: number;

  /** Unit / quantity as entered (display only). */
  @Column({ name: 'unit_id', type: 'uuid', nullable: true })
  unitId: string | null;

  @Column({ name: 'entered_quantity', type: 'decimal', precision: 18, scale: 4, nullable: true })
  enteredQuantity: number | null;

  @Column({ name: 'requested_lots', type: 'jsonb', nullable: true })
  requestedLots: StockIssueLotQty[] | null;

  /** Lots consumed on posting (given back on cancel). */
  @Column({ name: 'issued_lots', type: 'jsonb', default: () => "'[]'" })
  issuedLots: StockIssueLotQty[];

  @Column({ name: 'unit_cost', type: 'decimal', precision: 18, scale: 4, default: 0 })
  unitCost: number;

  @Column({ type: 'decimal', precision: 18, scale: 4, default: 0 })
  cost: number;

  @Column({ type: 'varchar', nullable: true })
  notes: string | null;

  @ManyToOne(() => StockIssue, (i) => i.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'issue_id' })
  issue: StockIssue;

  @ManyToOne(() => Product)
  @JoinColumn({ name: 'product_id' })
  product: Product;
}
