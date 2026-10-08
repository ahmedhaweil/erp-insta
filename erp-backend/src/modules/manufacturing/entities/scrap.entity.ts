import { Entity, Column } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

/**
 * Scrapped goods (Odoo stock.scrap / الهالك): stock written off at average
 * cost, optionally linked to a production order.
 */
@Entity('mfg_scraps')
export class Scrap extends TenantBaseEntity {
  @Column({ name: 'scrap_number' })
  scrapNumber: string;

  @Column({ name: 'production_order_id', type: 'uuid', nullable: true })
  productionOrderId: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ name: 'warehouse_id', type: 'uuid' })
  warehouseId: string;

  @Column({ type: 'decimal', precision: 18, scale: 4 })
  quantity: number;

  @Column({ name: 'unit_cost', type: 'decimal', precision: 18, scale: 4, default: 0 })
  unitCost: number;

  @Column({ type: 'decimal', precision: 18, scale: 4, default: 0 })
  cost: number;

  @Column({ type: 'date' })
  date: string;

  @Column({ nullable: true })
  reason: string;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;
}
