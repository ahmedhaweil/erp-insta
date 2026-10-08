import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '@shared/entities/base.entity';
import type { DocumentLot } from '@modules/inventory/services/document-lots.util';
import { PosOrder } from './pos-order.entity';

@Entity('pos_order_lines')
export class PosOrderLine extends BaseEntity {
  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ type: 'decimal', precision: 18, scale: 4 })
  quantity: number;

  @Column({ name: 'unit_price', type: 'decimal', precision: 18, scale: 4 })
  unitPrice: number;

  @Column({ type: 'decimal', precision: 18, scale: 4, default: 0 })
  discount: number;

  @Column({ name: 'tax_rate', type: 'decimal', precision: 5, scale: 2, default: 0 })
  taxRate: number;

  /** Quantity already returned through refunds (sale lines only). */
  @Column({ name: 'refunded_qty', type: 'decimal', precision: 18, scale: 4, default: 0 })
  refundedQty: number;

  /** Average cost of the goods when sold, used to restock refunds at that cost. */
  @Column({ name: 'unit_cost', type: 'decimal', precision: 18, scale: 4, default: 0 })
  unitCost: number;

  @Column({ name: 'line_total', type: 'decimal', precision: 18, scale: 4 })
  lineTotal: number;

  /** Alternate unit the quantity and unit price are expressed in (null = base unit). */
  @Column({ name: 'unit_id', type: 'uuid', nullable: true })
  unitId: string | null;

  /** Base units per line unit (1 for the base unit); stock moves use quantity x factor. */
  @Column({ name: 'unit_factor', type: 'decimal', precision: 18, scale: 6, default: 1 })
  unitFactor: number;

  /** Lots/serials sold (sale lines) or restored (refund lines) (base unit). */
  @Column({ name: 'lots', type: 'jsonb', default: () => "'[]'" })
  lots: DocumentLot[];

  /** Sold lots already restored by refunds (sale lines) (base unit). */
  @Column({ name: 'lots_refunded', type: 'jsonb', default: () => "'[]'" })
  lotsRefunded: DocumentLot[];

  @ManyToOne(() => PosOrder, (order) => order.lines)
  @JoinColumn({ name: 'order_id' })
  order: PosOrder;
}
