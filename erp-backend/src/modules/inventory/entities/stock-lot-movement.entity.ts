import { Entity, Column, Index } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

/** Lot-level detail of a stock movement, used for lot traceability. */
@Entity('stock_lot_movements')
@Index(['tenantId', 'productId', 'lotNumber'])
export class StockLotMovement extends TenantBaseEntity {
  @Column({ name: 'lot_id', type: 'uuid' })
  lotId: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ name: 'warehouse_id', type: 'uuid' })
  warehouseId: string;

  @Column({ name: 'lot_number' })
  lotNumber: string;

  @Column({ name: 'expiry_date', type: 'date', nullable: true })
  expiryDate: string | null;

  /** Signed: positive = into the lot, negative = out of it. */
  @Column({ type: 'decimal', precision: 18, scale: 4 })
  quantity: number;

  @Column({ name: 'movement_id', type: 'uuid', nullable: true })
  movementId: string;

  @Column({ name: 'reference_type', nullable: true })
  referenceType: string;

  @Column({ name: 'reference_id', type: 'uuid', nullable: true })
  referenceId: string;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string;
}
