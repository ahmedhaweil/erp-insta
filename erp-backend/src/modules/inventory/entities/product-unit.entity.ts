import { Entity, Column, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { Product } from './product.entity';
import { Unit } from './unit.entity';

/**
 * Alternate unit of measure of a product (e.g. carton = 12 pieces).
 * Stock is always kept in the product's base unit (`products.unit_id`).
 */
@Entity('product_units')
@Unique(['tenantId', 'productId', 'unitId'])
export class ProductUnit extends TenantBaseEntity {
  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ name: 'unit_id', type: 'uuid' })
  unitId: string;

  /** Base units contained in one of this unit. */
  @Column({ type: 'decimal', precision: 18, scale: 6 })
  factor: number;

  @Column({ type: 'varchar', nullable: true })
  barcode: string | null;

  /** Sell price of one of this unit; defaults to product sell price x factor. */
  @Column({ name: 'sell_price', type: 'decimal', precision: 18, scale: 4, nullable: true })
  sellPrice: number | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @ManyToOne(() => Product, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @ManyToOne(() => Unit)
  @JoinColumn({ name: 'unit_id' })
  unit: Unit;
}
