import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '@shared/entities/base.entity';
import { Payment } from './payment.entity';

/** Reconciliation of (part of) a payment with an invoice or bill. */
@Entity('payment_allocations')
export class PaymentAllocation extends BaseEntity {
  @Column({ name: 'payment_id', type: 'uuid' })
  paymentId: string;

  /** 'sales_invoice' or 'purchase_invoice'. */
  @Column({ name: 'invoice_type' })
  invoiceType: 'sales_invoice' | 'purchase_invoice';

  @Column({ name: 'invoice_id', type: 'uuid' })
  invoiceId: string;

  @Column({ type: 'decimal', precision: 18, scale: 4 })
  amount: number;

  @ManyToOne(() => Payment, (p) => p.allocations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'payment_id' })
  payment: Payment;
}
