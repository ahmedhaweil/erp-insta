import { Entity, Column, OneToMany } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { PaymentAllocation } from './payment-allocation.entity';

export enum PaymentPartnerType {
  CUSTOMER = 'customer',
  SUPPLIER = 'supplier',
}

/** inbound = money received, outbound = money paid. */
export enum PaymentDirection {
  INBOUND = 'inbound',
  OUTBOUND = 'outbound',
}

export enum PaymentMethod {
  CASH = 'cash',
  BANK = 'bank',
  CARD = 'card',
  CHEQUE = 'cheque',
}

export enum PaymentStatus {
  POSTED = 'posted',
  CANCELLED = 'cancelled',
}

@Entity('payments')
export class Payment extends TenantBaseEntity {
  @Column({ name: 'payment_number' })
  paymentNumber: string;

  @Column({ name: 'partner_type', type: 'enum', enum: PaymentPartnerType })
  partnerType: PaymentPartnerType;

  @Column({ name: 'partner_id', type: 'uuid' })
  partnerId: string;

  @Column({ type: 'enum', enum: PaymentDirection })
  direction: PaymentDirection;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'decimal', precision: 18, scale: 4 })
  amount: number;

  /** Part of the amount reconciled with invoices; the rest is an advance/credit. */
  @Column({ name: 'allocated_amount', type: 'decimal', precision: 18, scale: 4, default: 0 })
  allocatedAmount: number;

  @Column({ type: 'enum', enum: PaymentMethod, default: PaymentMethod.CASH })
  method: PaymentMethod;

  @Column({ nullable: true })
  reference: string;

  @Column({ type: 'enum', enum: PaymentStatus, default: PaymentStatus.POSTED })
  status: PaymentStatus;

  @Column({ name: 'currency_id', type: 'uuid', nullable: true })
  currencyId: string;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @OneToMany(() => PaymentAllocation, (a) => a.payment, { cascade: true })
  allocations: PaymentAllocation[];
}
