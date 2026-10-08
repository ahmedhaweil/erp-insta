import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '@shared/entities/base.entity';
import { SalesInvoice } from './sales-invoice.entity';

@Entity('sales_invoice_lines')
export class SalesInvoiceLine extends BaseEntity {
  @Column({ name: 'invoice_id', type: 'uuid' })
  invoiceId: string;

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

  @Column({ name: 'order_line_id', type: 'uuid', nullable: true })
  orderLineId: string;

  /** Line withholding rate (%); null = document rate. */
  @Column({ name: 'withholding_rate', type: 'decimal', precision: 5, scale: 2, nullable: true })
  withholdingRate: number | null;

  /** Quantity already returned through posted sales returns. */
  @Column({ name: 'qty_returned', type: 'decimal', precision: 18, scale: 4, default: 0 })
  qtyReturned: number;

  /** Alternate unit the quantity and unit price are expressed in (null = base unit). */
  @Column({ name: 'unit_id', type: 'uuid', nullable: true })
  unitId: string | null;

  /** Base units per line unit (1 for the base unit); stock moves use quantity x factor. */
  @Column({ name: 'unit_factor', type: 'decimal', precision: 18, scale: 6, default: 1 })
  unitFactor: number;

  @ManyToOne(() => SalesInvoice, (invoice) => invoice.lines)
  @JoinColumn({ name: 'invoice_id' })
  invoice: SalesInvoice;
}
