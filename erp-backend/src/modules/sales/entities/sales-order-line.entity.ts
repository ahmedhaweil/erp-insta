import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '@shared/entities/base.entity';
import type { DocumentLot } from '@modules/inventory/services/document-lots.util';
import { SalesOrder } from './sales-order.entity';

@Entity('sales_order_lines')
export class SalesOrderLine extends BaseEntity {
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

  @Column({ name: 'line_total', type: 'decimal', precision: 18, scale: 4 })
  lineTotal: number;

  @Column({ nullable: true })
  description: string;

  @Column({ name: 'qty_delivered', type: 'decimal', precision: 18, scale: 4, default: 0 })
  qtyDelivered: number;

  @Column({ name: 'qty_invoiced', type: 'decimal', precision: 18, scale: 4, default: 0 })
  qtyInvoiced: number;

  @Column({ name: 'qty_reserved', type: 'decimal', precision: 18, scale: 4, default: 0 })
  qtyReserved: number;

  /** Alternate unit the quantity and unit price are expressed in (null = base unit). */
  @Column({ name: 'unit_id', type: 'uuid', nullable: true })
  unitId: string | null;

  /** Base units per line unit (1 for the base unit); stock moves use quantity x factor. */
  @Column({ name: 'unit_factor', type: 'decimal', precision: 18, scale: 6, default: 1 })
  unitFactor: number;

  /** Note: qty_reserved is a stock reservation, kept in base units. */

  /** Lots/serial numbers delivered (base unit). */
  @Column({ name: 'lots', type: 'jsonb', default: () => "'[]'" })
  lots: DocumentLot[];

  /** Delivered lots already brought back by posted sales returns (base unit). */
  @Column({ name: 'lots_returned', type: 'jsonb', default: () => "'[]'" })
  lotsReturned: DocumentLot[];

  @ManyToOne(() => SalesOrder, (order) => order.lines)
  @JoinColumn({ name: 'order_id' })
  order: SalesOrder;
}
