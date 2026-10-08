import { Entity, Column, ManyToOne, JoinColumn, Unique, Index } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { Product } from './product.entity';
import { Warehouse } from './warehouse.entity';

/**
 * On-hand quantity of one lot (or one serial number) of a product in a
 * warehouse. The warehouse total stays in `stocks`; lots break part (or all)
 * of it down. Stock received before tracking was enabled stays untracked.
 */
@Entity('stock_lots')
@Unique(['tenantId', 'productId', 'warehouseId', 'lotNumber'])
@Index(['tenantId', 'productId', 'lotNumber'])
export class StockLot extends TenantBaseEntity {
  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ name: 'warehouse_id', type: 'uuid' })
  warehouseId: string;

  /** Lot/batch number, or the serial number for serial-tracked products. */
  @Column({ name: 'lot_number' })
  lotNumber: string;

  @Column({ name: 'expiry_date', type: 'date', nullable: true })
  expiryDate: string | null;

  @Column({ type: 'decimal', precision: 18, scale: 4, default: 0 })
  quantity: number;

  /** Unit cost at the first receipt of the lot (informational; valuation is AVCO). */
  @Column({ name: 'unit_cost', type: 'decimal', precision: 18, scale: 4, default: 0 })
  unitCost: number;

  @Column({ name: 'received_date', type: 'date', nullable: true })
  receivedDate: string;

  @ManyToOne(() => Product)
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @ManyToOne(() => Warehouse)
  @JoinColumn({ name: 'warehouse_id' })
  warehouse: Warehouse;
}
