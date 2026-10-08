import { Entity, Column, OneToMany, ManyToOne, JoinColumn, Index } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { Product } from '@modules/inventory/entities/product.entity';
import { BomLine } from './bom-line.entity';

/**
 * Bill of materials (Odoo mrp.bom / قائمة المواد). Component and by-product
 * quantities are for `outputQuantity` units of the finished product.
 * A product can have several versions; at most one is active and is used by
 * default for production orders and multi-level explosion.
 */
@Entity('mfg_boms')
@Index(['tenantId', 'productId'])
export class Bom extends TenantBaseEntity {
  @Column()
  code: string;

  @Column({ nullable: true })
  name: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ name: 'output_quantity', type: 'decimal', precision: 18, scale: 4, default: 1 })
  outputQuantity: number;

  @Column({ type: 'int', default: 1 })
  version: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  /** Fixed direct labour cost per finished unit (absorbed into the product cost). */
  @Column({ name: 'labour_cost_per_unit', type: 'decimal', precision: 18, scale: 4, default: 0 })
  labourCostPerUnit: number;

  /** Fixed manufacturing overhead per finished unit. */
  @Column({ name: 'overhead_cost_per_unit', type: 'decimal', precision: 18, scale: 4, default: 0 })
  overheadCostPerUnit: number;

  @Column({ nullable: true })
  notes: string;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string;

  @ManyToOne(() => Product)
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @OneToMany(() => BomLine, (l) => l.bom, { cascade: true })
  lines: BomLine[];
}
