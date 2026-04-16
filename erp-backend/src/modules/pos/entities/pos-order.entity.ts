import { Entity, Column, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { PosSession } from './pos-session.entity';
import { PosOrderLine } from './pos-order-line.entity';

export enum PosPaymentMethod {
  CASH = 'cash',
  CARD = 'card',
  SPLIT = 'split',
}

export enum PosOrderStatus {
  COMPLETED = 'completed',
  REFUNDED = 'refunded',
  VOID = 'void',
}

@Entity('pos_orders')
export class PosOrder extends TenantBaseEntity {
  @Column({ name: 'session_id', type: 'uuid' })
  sessionId: string;

  @Column({ name: 'order_number' })
  orderNumber: string;

  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId: string;

  @Column({ type: 'decimal', precision: 18, scale: 4, default: 0 })
  subtotal: number;

  @Column({ name: 'tax_amount', type: 'decimal', precision: 18, scale: 4, default: 0 })
  taxAmount: number;

  @Column({ name: 'total_amount', type: 'decimal', precision: 18, scale: 4, default: 0 })
  totalAmount: number;

  @Column({ type: 'decimal', precision: 18, scale: 4, default: 0 })
  discount: number;

  @Column({ name: 'payment_method', type: 'enum', enum: PosPaymentMethod })
  paymentMethod: PosPaymentMethod;

  @Column({ type: 'enum', enum: PosOrderStatus, default: PosOrderStatus.COMPLETED })
  status: PosOrderStatus;

  @Column({ name: 'cash_received', type: 'decimal', precision: 18, scale: 4, nullable: true })
  cashReceived: number;

  @Column({ name: 'change_amount', type: 'decimal', precision: 18, scale: 4, nullable: true })
  changeAmount: number;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @ManyToOne(() => PosSession)
  @JoinColumn({ name: 'session_id' })
  session: PosSession;

  @OneToMany(() => PosOrderLine, (line) => line.order)
  lines: PosOrderLine[];
}
