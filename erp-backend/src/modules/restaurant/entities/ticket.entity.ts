import { Entity, Column, Index, OneToMany, ManyToOne, JoinColumn } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { BaseEntity } from '@shared/entities/base.entity';
import { ModifierType } from './menu.entity';

export enum TicketOrderType {
  DINE_IN = 'dine_in',
  TAKEAWAY = 'takeaway',
  PICKUP = 'pickup',
  DELIVERY = 'delivery',
}

export enum TicketStatus {
  OPEN = 'open',
  PAID = 'paid',
  VOID = 'void',
}

/** Snapshot of a modifier as chosen on a ticket line. */
export interface LineModifier {
  modifierId: string;
  type: ModifierType;
  nameAr: string;
  nameEn?: string | null;
  price: number;
  stockProductId?: string | null;
  stockQuantity?: number;
  ingredientProductId?: string | null;
}

/**
 * Restaurant ticket (open order / check). Lines are added while the guests
 * are served; it is paid once through the POS, which records the sale,
 * issues the stock and posts the journal entry.
 */
@Entity('restaurant_tickets')
@Index(['tenantId', 'status'])
@Index(['tenantId', 'tableId', 'status'])
export class RestaurantTicket extends TenantBaseEntity {
  @Column({ name: 'ticket_number' })
  ticketNumber: string;

  /** Short number called out / printed (resets daily, per session or never). */
  @Column({ name: 'display_number', type: 'int' })
  displayNumber: number;

  @Column({ name: 'order_type', type: 'enum', enum: TicketOrderType })
  orderType: TicketOrderType;

  @Column({ type: 'enum', enum: TicketStatus, default: TicketStatus.OPEN })
  status: TicketStatus;

  @Column({ name: 'table_id', type: 'uuid', nullable: true })
  tableId: string | null;

  @Column({ type: 'int', nullable: true })
  guests: number | null;

  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId: string | null;

  @Column({ name: 'customer_phone', type: 'varchar', nullable: true })
  customerPhone: string | null;

  @Column({ name: 'delivery_address', type: 'varchar', nullable: true })
  deliveryAddress: string | null;

  @Column({ name: 'zone_id', type: 'uuid', nullable: true })
  zoneId: string | null;

  /** Delivery fee (net of tax); defaults to the zone fee. */
  @Column({ name: 'delivery_fee', type: 'decimal', precision: 18, scale: 4, default: 0 })
  deliveryFee: number;

  @Column({ name: 'driver_id', type: 'uuid', nullable: true })
  driverId: string | null;

  @Column({ name: 'delivery_app_id', type: 'uuid', nullable: true })
  deliveryAppId: string | null;

  /** Order reference in the aggregator's system. */
  @Column({ name: 'app_reference', type: 'varchar', nullable: true })
  appReference: string | null;

  /** POS session the ticket was opened in (drives per-session numbering). */
  @Column({ name: 'session_id', type: 'uuid', nullable: true })
  sessionId: string | null;

  @Column({ type: 'varchar', nullable: true })
  notes: string | null;

  /** Manual discount on the whole ticket (amount, before tax). */
  @Column({ name: 'invoice_discount', type: 'decimal', precision: 18, scale: 4, default: 0 })
  invoiceDiscount: number;

  // ---- totals, recomputed server-side after every change
  /** Items before any discount. */
  @Column({ name: 'items_gross', type: 'decimal', precision: 18, scale: 4, default: 0 })
  itemsGross: number;

  /** Line discounts + invoice discount. */
  @Column({ name: 'discount_total', type: 'decimal', precision: 18, scale: 4, default: 0 })
  discountTotal: number;

  /** Items after discounts, before tax. */
  @Column({ name: 'items_net', type: 'decimal', precision: 18, scale: 4, default: 0 })
  itemsNet: number;

  @Column({ name: 'service_charge_percent', type: 'decimal', precision: 7, scale: 4, default: 0 })
  serviceChargePercent: number;

  @Column({ name: 'service_charge', type: 'decimal', precision: 18, scale: 4, default: 0 })
  serviceCharge: number;

  /** Net before tax: items net + service charge + delivery fee. */
  @Column({ type: 'decimal', precision: 18, scale: 4, default: 0 })
  subtotal: number;

  @Column({ name: 'tax_amount', type: 'decimal', precision: 18, scale: 4, default: 0 })
  taxAmount: number;

  @Column({ name: 'total_amount', type: 'decimal', precision: 18, scale: 4, default: 0 })
  totalAmount: number;

  @Column({ name: 'opened_at', type: 'timestamptz' })
  openedAt: Date;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @Column({ name: 'paid_by', type: 'uuid', nullable: true })
  paidBy: string | null;

  /** The POS sale that settled the ticket. */
  @Column({ name: 'pos_order_id', type: 'uuid', nullable: true })
  posOrderId: string | null;

  @Column({ name: 'voided_at', type: 'timestamptz', nullable: true })
  voidedAt: Date | null;

  @Column({ name: 'voided_by', type: 'uuid', nullable: true })
  voidedBy: string | null;

  @Column({ name: 'void_reason', type: 'varchar', nullable: true })
  voidReason: string | null;

  /** Set when this ticket was merged into another one (and voided). */
  @Column({ name: 'merged_into_id', type: 'uuid', nullable: true })
  mergedIntoId: string | null;

  /** Set on a ticket created by splitting another. */
  @Column({ name: 'split_from_id', type: 'uuid', nullable: true })
  splitFromId: string | null;

  @OneToMany(() => RestaurantTicketLine, (l) => l.ticket)
  lines: RestaurantTicketLine[];
}

@Entity('restaurant_ticket_lines')
@Index(['ticketId'])
export class RestaurantTicketLine extends BaseEntity {
  @Column({ name: 'ticket_id', type: 'uuid' })
  ticketId: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ type: 'decimal', precision: 18, scale: 4 })
  quantity: number;

  /** Quantity already sent to the kitchen. */
  @Column({ name: 'sent_qty', type: 'decimal', precision: 18, scale: 4, default: 0 })
  sentQty: number;

  /** List or delivery-app price before modifiers. */
  @Column({ name: 'base_price', type: 'decimal', precision: 18, scale: 4, default: 0 })
  basePrice: number;

  /** Base price + addons - withouts, floored at 0 (or the combo extra price). */
  @Column({ name: 'unit_price', type: 'decimal', precision: 18, scale: 4, default: 0 })
  unitPrice: number;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  modifiers: LineModifier[];

  @Column({ type: 'varchar', nullable: true })
  note: string | null;

  /** Component line of a combo: the combo (parent) line. */
  @Column({ name: 'combo_parent_line_id', type: 'uuid', nullable: true })
  comboParentLineId: string | null;

  @Column({ name: 'combo_group_id', type: 'uuid', nullable: true })
  comboGroupId: string | null;

  /** Component units per combo unit. */
  @Column({ name: 'combo_unit_qty', type: 'decimal', precision: 18, scale: 4, nullable: true })
  comboUnitQty: number | null;

  /** Line discount amount (before tax). */
  @Column({ type: 'decimal', precision: 18, scale: 4, default: 0 })
  discount: number;

  @Column({ name: 'tax_rate', type: 'decimal', precision: 5, scale: 2, default: 0 })
  taxRate: number;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @ManyToOne(() => RestaurantTicket, (t) => t.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ticket_id' })
  ticket: RestaurantTicket;
}

export enum KitchenTicketStatus {
  NEW = 'new',
  PREPARING = 'preparing',
  READY = 'ready',
  SERVED = 'served',
  CANCELLED = 'cancelled',
}

export interface KitchenTicketItem {
  lineId: string;
  productId: string;
  nameAr?: string;
  nameEn?: string | null;
  /** Negative = cancellation of a quantity sent earlier. */
  quantity: number;
  modifiers: LineModifier[];
  note?: string | null;
}

/** What one kitchen station has to prepare for one send of a ticket. */
@Entity('restaurant_kitchen_tickets')
@Index(['tenantId', 'stationId', 'status'])
export class KitchenTicket extends TenantBaseEntity {
  @Column({ name: 'ticket_id', type: 'uuid' })
  ticketId: string;

  @Column({ name: 'ticket_number' })
  ticketNumber: string;

  @Column({ name: 'display_number', type: 'int' })
  displayNumber: number;

  @Column({ name: 'order_type', type: 'enum', enum: TicketOrderType })
  orderType: TicketOrderType;

  @Column({ name: 'table_name', type: 'varchar', nullable: true })
  tableName: string | null;

  @Column({ name: 'station_id', type: 'uuid' })
  stationId: string;

  @Column({ type: 'enum', enum: KitchenTicketStatus, default: KitchenTicketStatus.NEW })
  status: KitchenTicketStatus;

  /** Only cancellations (negative quantities). */
  @Column({ name: 'is_cancellation', default: false })
  isCancellation: boolean;

  @Column({ type: 'jsonb' })
  items: KitchenTicketItem[];

  @Column({ name: 'sent_by', type: 'uuid' })
  sentBy: string;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'ready_at', type: 'timestamptz', nullable: true })
  readyAt: Date | null;

  @Column({ name: 'served_at', type: 'timestamptz', nullable: true })
  servedAt: Date | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;
}

/** Audit of items removed or reduced after they were sent to the kitchen. */
@Entity('restaurant_void_logs')
@Index(['tenantId', 'createdAt'])
export class RestaurantVoidLog extends TenantBaseEntity {
  @Column({ name: 'ticket_id', type: 'uuid' })
  ticketId: string;

  @Column({ name: 'ticket_number' })
  ticketNumber: string;

  @Column({ name: 'line_id', type: 'uuid', nullable: true })
  lineId: string | null;

  @Column({ name: 'product_id', type: 'uuid', nullable: true })
  productId: string | null;

  @Column({ type: 'decimal', precision: 18, scale: 4, default: 0 })
  quantity: number;

  @Column({ name: 'unit_price', type: 'decimal', precision: 18, scale: 4, default: 0 })
  unitPrice: number;

  @Column({ type: 'decimal', precision: 18, scale: 4, default: 0 })
  amount: number;

  /** line = item removed/reduced, ticket = whole ticket voided. */
  @Column({ default: 'line' })
  kind: 'line' | 'ticket';

  @Column({ type: 'varchar', nullable: true })
  reason: string | null;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;
}
