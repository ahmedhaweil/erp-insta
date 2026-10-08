import { Entity, Column, OneToMany, ManyToOne, JoinColumn } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { Product } from '@modules/inventory/entities/product.entity';
import { ProductionOrderLine } from './production-order-line.entity';

export enum ProductionOrderStatus {
  DRAFT = 'draft',
  CONFIRMED = 'confirmed',
  IN_PROGRESS = 'in_progress',
  DONE = 'done',
  CANCELLED = 'cancelled',
}

/**
 * Production / manufacturing order (Odoo mrp.production / أمر إنتاج).
 * Lines are a snapshot of the BOM scaled to the planned quantity, so later
 * BOM changes do not affect orders already created.
 */
@Entity('mfg_production_orders')
export class ProductionOrder extends TenantBaseEntity {
  @Column({ name: 'order_number' })
  orderNumber: string;

  @Column({ name: 'bom_id', type: 'uuid' })
  bomId: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ name: 'planned_quantity', type: 'decimal', precision: 18, scale: 4 })
  plannedQuantity: number;

  @Column({ name: 'produced_quantity', type: 'decimal', precision: 18, scale: 4, default: 0 })
  producedQuantity: number;

  @Column({ type: 'enum', enum: ProductionOrderStatus, default: ProductionOrderStatus.DRAFT })
  status: ProductionOrderStatus;

  @Column({ name: 'source_warehouse_id', type: 'uuid' })
  sourceWarehouseId: string;

  @Column({ name: 'destination_warehouse_id', type: 'uuid' })
  destinationWarehouseId: string;

  @Column({ name: 'planned_date', type: 'date', nullable: true })
  plannedDate: string;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date;

  @Column({ name: 'completed_date', type: 'date', nullable: true })
  completedDate: string;

  /** Multi-level BOMs were exploded into leaf components when the order was created. */
  @Column({ default: false })
  exploded: boolean;

  @Column({ name: 'labour_cost_per_unit', type: 'decimal', precision: 18, scale: 4, default: 0 })
  labourCostPerUnit: number;

  @Column({ name: 'overhead_cost_per_unit', type: 'decimal', precision: 18, scale: 4, default: 0 })
  overheadCostPerUnit: number;

  /** Standard (planned) cost per finished unit, frozen at confirmation. */
  @Column({ name: 'standard_unit_cost', type: 'decimal', precision: 18, scale: 4, default: 0 })
  standardUnitCost: number;

  /** Actual cost of components consumed so far. */
  @Column({ name: 'actual_component_cost', type: 'decimal', precision: 18, scale: 4, default: 0 })
  actualComponentCost: number;

  @Column({ name: 'actual_labour_cost', type: 'decimal', precision: 18, scale: 4, default: 0 })
  actualLabourCost: number;

  @Column({ name: 'actual_overhead_cost', type: 'decimal', precision: 18, scale: 4, default: 0 })
  actualOverheadCost: number;

  @Column({ name: 'scrap_cost', type: 'decimal', precision: 18, scale: 4, default: 0 })
  scrapCost: number;

  @Column({ nullable: true })
  notes: string;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @ManyToOne(() => Product)
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @OneToMany(() => ProductionOrderLine, (l) => l.order, { cascade: true })
  lines: ProductionOrderLine[];
}
