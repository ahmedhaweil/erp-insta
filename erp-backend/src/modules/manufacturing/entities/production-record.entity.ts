import { Entity, Column } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

export interface ProductionRecordMove {
  productId: string;
  type: 'component' | 'by_product';
  /** Quantity the BOM expected for this run (scrap allowance included). */
  expectedQuantity: number;
  quantity: number;
  unitCost: number;
  cost: number;
}

/** One (partial) production run of a production order: what was consumed and produced. */
@Entity('mfg_production_records')
export class ProductionRecord extends TenantBaseEntity {
  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'decimal', precision: 18, scale: 4 })
  quantity: number;

  @Column({ name: 'component_cost', type: 'decimal', precision: 18, scale: 4, default: 0 })
  componentCost: number;

  @Column({ name: 'labour_cost', type: 'decimal', precision: 18, scale: 4, default: 0 })
  labourCost: number;

  @Column({ name: 'overhead_cost', type: 'decimal', precision: 18, scale: 4, default: 0 })
  overheadCost: number;

  /** Part of the cost assigned to by-products. */
  @Column({ name: 'by_product_cost', type: 'decimal', precision: 18, scale: 4, default: 0 })
  byProductCost: number;

  /** Unit cost of the finished product received into stock. */
  @Column({ name: 'unit_cost', type: 'decimal', precision: 18, scale: 4, default: 0 })
  unitCost: number;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  moves: ProductionRecordMove[];

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;
}
