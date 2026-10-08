import { Entity, Column, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { Warehouse } from './warehouse.entity';
import { Product } from './product.entity';

export enum StockCountStatus {
  OPEN = 'open',
  VALIDATED = 'validated',
  CANCELLED = 'cancelled',
}

/** Physical inventory session (جرد) of one warehouse. */
@Entity('stock_counts')
export class StockCount extends TenantBaseEntity {
  @Column({ name: 'count_number' })
  countNumber: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ name: 'warehouse_id', type: 'uuid' })
  warehouseId: string;

  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId: string | null;

  @Column({ type: 'enum', enum: StockCountStatus, default: StockCountStatus.OPEN })
  status: StockCountStatus;

  @Column({ type: 'varchar', nullable: true })
  notes: string | null;

  @Column({ name: 'validated_at', type: 'timestamptz', nullable: true })
  validatedAt: Date | null;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  /** Net value of the differences applied at validation (gain +, loss -). */
  @Column({ name: 'difference_value', type: 'decimal', precision: 18, scale: 4, default: 0 })
  differenceValue: number;

  @ManyToOne(() => Warehouse)
  @JoinColumn({ name: 'warehouse_id' })
  warehouse: Warehouse;

  @OneToMany(() => StockCountLine, (line) => line.count, { cascade: true })
  lines: StockCountLine[];
}

@Entity('stock_count_lines')
export class StockCountLine extends TenantBaseEntity {
  @Column({ name: 'count_id', type: 'uuid' })
  countId: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  /** Null for untracked products and for the untracked part of tracked ones. */
  @Column({ name: 'lot_number', type: 'varchar', nullable: true })
  lotNumber: string | null;

  @Column({ name: 'expiry_date', type: 'date', nullable: true })
  expiryDate: string | null;

  /** System quantity at snapshot time. */
  @Column({ name: 'system_qty', type: 'decimal', precision: 18, scale: 4, default: 0 })
  systemQty: number;

  @Column({ name: 'counted_qty', type: 'decimal', precision: 18, scale: 4, nullable: true })
  countedQty: number | null;

  @Column({ name: 'unit_cost', type: 'decimal', precision: 18, scale: 4, default: 0 })
  unitCost: number;

  /** Quantity adjusted at validation (counted - on hand at that moment). */
  @Column({ name: 'applied_qty', type: 'decimal', precision: 18, scale: 4, nullable: true })
  appliedQty: number | null;

  @ManyToOne(() => StockCount, (count) => count.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'count_id' })
  count: StockCount;

  @ManyToOne(() => Product)
  @JoinColumn({ name: 'product_id' })
  product: Product;
}
