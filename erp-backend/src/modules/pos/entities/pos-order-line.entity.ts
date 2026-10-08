import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '@shared/entities/base.entity';
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

  @ManyToOne(() => PosOrder, (order) => order.lines)
  @JoinColumn({ name: 'order_id' })
  order: PosOrder;
}
