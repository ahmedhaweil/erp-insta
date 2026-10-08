import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { Product } from '@modules/inventory/entities/product.entity';
import { ProductionOrder } from './production-order.entity';
import { BomLineType } from './bom-line.entity';

@Entity('mfg_production_order_lines')
export class ProductionOrderLine extends TenantBaseEntity {
  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({ type: 'enum', enum: BomLineType, default: BomLineType.COMPONENT })
  type: BomLineType;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  /** Planned quantity for the whole order, scrap allowance included. */
  @Column({ name: 'planned_quantity', type: 'decimal', precision: 18, scale: 4 })
  plannedQuantity: number;

  @Column({ name: 'scrap_percent', type: 'decimal', precision: 7, scale: 4, default: 0 })
  scrapPercent: number;

  @Column({ name: 'cost_share_percent', type: 'decimal', precision: 7, scale: 4, default: 0 })
  costSharePercent: number;

  /** Components: quantity consumed; by-products: quantity produced. */
  @Column({ name: 'done_quantity', type: 'decimal', precision: 18, scale: 4, default: 0 })
  doneQuantity: number;

  /** Quantity currently reserved in the source warehouse for this line. */
  @Column({ name: 'reserved_quantity', type: 'decimal', precision: 18, scale: 4, default: 0 })
  reservedQuantity: number;

  /** Unit cost at confirmation (standard cost). */
  @Column({ name: 'standard_unit_cost', type: 'decimal', precision: 18, scale: 4, default: 0 })
  standardUnitCost: number;

  /** Actual value consumed (components) or received (by-products). */
  @Column({ name: 'actual_cost', type: 'decimal', precision: 18, scale: 4, default: 0 })
  actualCost: number;

  @ManyToOne(() => ProductionOrder, (o) => o.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: ProductionOrder;

  @ManyToOne(() => Product)
  @JoinColumn({ name: 'product_id' })
  product: Product;
}
