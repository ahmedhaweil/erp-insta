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
  /** Cheque payment undone because the cheque bounced or was handed back. */
  BOUNCED = 'bounced',
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

  /**
   * Tax withheld at source (customer withheld from us, or we withheld from
   * the supplier). The partner is settled for amount + withholdingAmount.
   */
  @Column({ name: 'withholding_amount', type: 'decimal', precision: 18, scale: 4, default: 0 })
  withholdingAmount: number;

  /**
   * Settlement discount (خصم مسموح به / خصم مكتسب): allowed to the customer on
   * a receipt, or received from the supplier on a payment. The partner is
   * settled for amount + withholdingAmount + discountAllowed.
   */
  @Column({ name: 'discount_allowed', type: 'decimal', precision: 18, scale: 4, default: 0 })
  discountAllowed: number;

  /** Part of the settled amount reconciled with invoices; the rest is an advance/credit. */
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

  /** Base-currency units per unit of the payment currency. */
  @Column({ name: 'exchange_rate', type: 'decimal', precision: 12, scale: 6, default: 1 })
  exchangeRate: number;

  /** Cash box / bank account the money went through (falls back to default cash/bank accounts). */
  @Column({ name: 'treasury_id', type: 'uuid', nullable: true })
  treasuryId: string;

  /** Cheque payments: the cheque created (or endorsed) by this payment. */
  @Column({ name: 'cheque_id', type: 'uuid', nullable: true })
  chequeId: string;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @OneToMany(() => PaymentAllocation, (a) => a.payment, { cascade: true })
  allocations: PaymentAllocation[];
}
