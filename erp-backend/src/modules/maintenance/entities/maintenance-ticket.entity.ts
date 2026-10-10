import { Entity, Column, OneToMany, ManyToOne, JoinColumn } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { BaseEntity } from '@shared/entities/base.entity';

export enum TicketStatus {
  RECEIVED = 'received',
  DIAGNOSING = 'diagnosing',
  AWAITING_APPROVAL = 'awaiting_approval',
  IN_REPAIR = 'in_repair',
  READY = 'ready',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
  RESCHEDULED = 'rescheduled',
}

export enum TicketType {
  IN_SHOP = 'in_shop',
  ON_SITE = 'on_site',
}

/** Repair ticket (Instasoft "device_add"), numbered RPR-000001. */
@Entity('maintenance_tickets')
export class MaintenanceTicket extends TenantBaseEntity {
  @Column({ name: 'ticket_number' })
  ticketNumber: string;

  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId: string | null;

  /** Free-text customer details for walk-ins (or a snapshot for known customers). */
  @Column({ name: 'customer_name', nullable: true })
  customerName: string;

  @Column({ name: 'customer_phone', nullable: true })
  customerPhone: string;

  @Column({ name: 'customer_address', nullable: true })
  customerAddress: string;

  @Column({ type: 'enum', enum: TicketType, default: TicketType.IN_SHOP })
  type: TicketType;

  @Column({ name: 'device_name' })
  deviceName: string;

  @Column({ nullable: true })
  brand: string;

  @Column({ nullable: true })
  model: string;

  @Column({ name: 'serial_number', nullable: true })
  serialNumber: string;

  @Column({ name: 'accessories_received', nullable: true })
  accessoriesReceived: string;

  @Column({ type: 'text' })
  problem: string;

  @Column({ type: 'text', nullable: true })
  diagnosis: string;

  @Column({ name: 'received_date', type: 'date' })
  receivedDate: string;

  /** Date the device is promised back to the customer. */
  @Column({ name: 'promised_date', type: 'date', nullable: true })
  promisedDate: string | null;

  /** Appointment (on-site visit or pick-up), moved by rescheduling. */
  @Column({ name: 'appointment_date', type: 'date', nullable: true })
  appointmentDate: string | null;

  @Column({ name: 'technician_id', type: 'uuid', nullable: true })
  technicianId: string | null;

  @Column({ name: 'estimated_cost', type: 'decimal', precision: 18, scale: 4, default: 0 })
  estimatedCost: number;

  /** Ceiling the customer agreed to; null = no ceiling. */
  @Column({ name: 'max_approved_cost', type: 'decimal', precision: 18, scale: 4, nullable: true })
  maxApprovedCost: number | null;

  @Column({ name: 'customer_approved', default: false })
  customerApproved: boolean;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'is_warranty', default: false })
  isWarranty: boolean;

  @Column({ name: 'warranty_until', type: 'date', nullable: true })
  warrantyUntil: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ type: 'enum', enum: TicketStatus, default: TicketStatus.RECEIVED })
  status: TicketStatus;

  /** Status to return to when a rescheduled ticket resumes. */
  @Column({ name: 'previous_status', type: 'varchar', nullable: true })
  previousStatus: TicketStatus | null;

  /** Warehouse parts are taken from; defaults to the maintenance settings. */
  @Column({ name: 'warehouse_id', type: 'uuid', nullable: true })
  warehouseId: string | null;

  /** Sum of part and labour lines. */
  @Column({ name: 'total_cost', type: 'decimal', precision: 18, scale: 4, default: 0 })
  totalCost: number;

  @Column({ name: 'sales_invoice_id', type: 'uuid', nullable: true })
  salesInvoiceId: string | null;

  /** Invoice total (VAT included), used for revenue reports. */
  @Column({ name: 'invoiced_amount', type: 'decimal', precision: 18, scale: 4, default: 0 })
  invoicedAmount: number;

  @Column({ name: 'invoiced_at', type: 'timestamptz', nullable: true })
  invoicedAt: Date | null;

  /** Spare parts have been issued from stock (on invoicing, or on delivery when not invoiced). */
  @Column({ name: 'parts_issued', default: false })
  partsIssued: boolean;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt: Date | null;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @OneToMany(() => MaintenanceTicketPart, (l) => l.ticket)
  parts: MaintenanceTicketPart[];

  @OneToMany(() => MaintenanceTicketLabour, (l) => l.ticket)
  labour: MaintenanceTicketLabour[];

  @OneToMany(() => MaintenanceTicketHistory, (l) => l.ticket)
  history: MaintenanceTicketHistory[];
}

@Entity('maintenance_ticket_parts')
export class MaintenanceTicketPart extends BaseEntity {
  @Column({ name: 'ticket_id', type: 'uuid' })
  ticketId: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ type: 'decimal', precision: 18, scale: 4 })
  quantity: number;

  @Column({ name: 'unit_price', type: 'decimal', precision: 18, scale: 4 })
  unitPrice: number;

  @Column({ name: 'tax_rate', type: 'decimal', precision: 5, scale: 2, default: 0 })
  taxRate: number;

  /** Quantity reserved in the ticket warehouse (released on issue / removal / cancel). */
  @Column({ name: 'reserved_qty', type: 'decimal', precision: 18, scale: 4, default: 0 })
  reservedQty: number;

  @Column({ name: 'unit_cost', type: 'decimal', precision: 18, scale: 4, default: 0 })
  unitCost: number;

  @Column({ name: 'line_total', type: 'decimal', precision: 18, scale: 4 })
  lineTotal: number;

  @ManyToOne(() => MaintenanceTicket, (t) => t.parts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ticket_id' })
  ticket: MaintenanceTicket;
}

@Entity('maintenance_ticket_labour')
export class MaintenanceTicketLabour extends BaseEntity {
  @Column({ name: 'ticket_id', type: 'uuid' })
  ticketId: string;

  @Column()
  description: string;

  @Column({ type: 'decimal', precision: 18, scale: 4 })
  amount: number;

  /** Service product invoiced; defaults to the settings labour product. */
  @Column({ name: 'service_product_id', type: 'uuid', nullable: true })
  serviceProductId: string | null;

  @Column({ name: 'technician_id', type: 'uuid', nullable: true })
  technicianId: string | null;

  @ManyToOne(() => MaintenanceTicket, (t) => t.labour, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ticket_id' })
  ticket: MaintenanceTicket;
}

@Entity('maintenance_ticket_history')
export class MaintenanceTicketHistory extends BaseEntity {
  @Column({ name: 'ticket_id', type: 'uuid' })
  ticketId: string;

  @Column({ name: 'from_status', type: 'varchar', nullable: true })
  fromStatus: TicketStatus | null;

  @Column({ name: 'to_status', type: 'varchar' })
  toStatus: TicketStatus;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @ManyToOne(() => MaintenanceTicket, (t) => t.history, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ticket_id' })
  ticket: MaintenanceTicket;
}
