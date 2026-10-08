import { Entity, Column, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { Customer } from './customer.entity';
import { SalesOrderLine } from './sales-order-line.entity';

export enum SalesOrderInvoiceStatus {
  NOTHING = 'nothing',
  TO_INVOICE = 'to_invoice',
  PARTIAL = 'partial',
  INVOICED = 'invoiced',
}

export enum SalesOrderDeliveryStatus {
  PENDING = 'pending',
  PARTIAL = 'partial',
  DELIVERED = 'delivered',
}

export enum SalesOrderStatus {
  DRAFT = 'draft',
  SENT = 'sent',
  CONFIRMED = 'confirmed',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
}

@Entity('sales_orders')
export class SalesOrder extends TenantBaseEntity {
  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @Column({ name: 'order_number' })
  orderNumber: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'enum', enum: SalesOrderStatus, default: SalesOrderStatus.DRAFT })
  status: SalesOrderStatus;

  @Column({ type: 'decimal', precision: 18, scale: 4, default: 0 })
  subtotal: number;

  @Column({ name: 'tax_amount', type: 'decimal', precision: 18, scale: 4, default: 0 })
  taxAmount: number;

  @Column({ name: 'total_amount', type: 'decimal', precision: 18, scale: 4, default: 0 })
  totalAmount: number;

  @Column({ name: 'currency_id', type: 'uuid', nullable: true })
  currencyId: string;

  @Column({ name: 'exchange_rate', type: 'decimal', precision: 12, scale: 6, default: 1 })
  exchangeRate: number;

  @Column({ nullable: true })
  notes: string;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string;

  /** Warehouse goods are reserved in and delivered from. */
  @Column({ name: 'warehouse_id', type: 'uuid', nullable: true })
  warehouseId: string;

  /** Quotation expiry date; expired quotations cannot be confirmed. */
  @Column({ name: 'validity_date', type: 'date', nullable: true })
  validityDate: string;

  @Column({ name: 'invoice_status', default: SalesOrderInvoiceStatus.NOTHING })
  invoiceStatus: SalesOrderInvoiceStatus;

  @Column({ name: 'delivery_status', default: SalesOrderDeliveryStatus.PENDING })
  deliveryStatus: SalesOrderDeliveryStatus;

  /** Sales representative credited with the document (commissions). */
  @Column({ name: 'sales_rep_id', type: 'uuid', nullable: true })
  salesRepId: string | null;

  /** Price list used to price lines sent without a unit price. */
  @Column({ name: 'price_list_id', type: 'uuid', nullable: true })
  priceListId: string | null;

  /** Unit prices include VAT (tax-inclusive pricing). */
  @Column({ name: 'prices_include_tax', default: false })
  pricesIncludeTax: boolean;

  @ManyToOne(() => Customer)
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  @OneToMany(() => SalesOrderLine, (line) => line.order, { cascade: true })
  lines: SalesOrderLine[];
}
