import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '@shared/entities/base.entity';
import { PurchaseInvoice } from './purchase-invoice.entity';

@Entity('purchase_invoice_lines')
export class PurchaseInvoiceLine extends BaseEntity {
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

  @ManyToOne(() => PurchaseInvoice, (invoice) => invoice.lines)
  @JoinColumn({ name: 'invoice_id' })
  invoice: PurchaseInvoice;
}
