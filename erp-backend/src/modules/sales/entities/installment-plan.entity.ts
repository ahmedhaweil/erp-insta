import { Entity, Column, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { BaseEntity } from '@shared/entities/base.entity';
import { Customer } from './customer.entity';
import { SalesInvoice } from './sales-invoice.entity';

export enum InstallmentFrequency {
  MONTHLY = 'monthly',
  WEEKLY = 'weekly',
}

export enum InstallmentPlanStatus {
  ACTIVE = 'active',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export enum InstallmentStatus {
  DUE = 'due',
  PARTIAL = 'partial',
  PAID = 'paid',
  OVERDUE = 'overdue',
}

/**
 * Installment sale plan on a posted invoice. The plan covers the invoice
 * residual at creation (`principalAmount`) plus simple financing interest.
 */
@Entity('installment_plans')
export class InstallmentPlan extends TenantBaseEntity {
  @Column({ name: 'plan_number' })
  planNumber: string;

  @Column({ name: 'invoice_id', type: 'uuid' })
  invoiceId: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @Column({ name: 'start_date', type: 'date' })
  startDate: string;

  @Column({ name: 'first_due_date', type: 'date' })
  firstDueDate: string;

  @Column({ type: 'enum', enum: InstallmentFrequency, default: InstallmentFrequency.MONTHLY })
  frequency: InstallmentFrequency;

  @Column({ name: 'number_of_installments', type: 'int' })
  numberOfInstallments: number;

  /** Invoice residual covered by the plan. */
  @Column({ name: 'principal_amount', type: 'decimal', precision: 18, scale: 4 })
  principalAmount: number;

  @Column({ name: 'down_payment', type: 'decimal', precision: 18, scale: 4, default: 0 })
  downPayment: number;

  /** Simple financing rate (%) on the financed amount (principal - down payment). */
  @Column({ name: 'interest_rate', type: 'decimal', precision: 7, scale: 4, default: 0 })
  interestRate: number;

  @Column({ name: 'interest_amount', type: 'decimal', precision: 18, scale: 4, default: 0 })
  interestAmount: number;

  /** principal + interest. */
  @Column({ name: 'total_amount', type: 'decimal', precision: 18, scale: 4 })
  totalAmount: number;

  /** Invoice paid amount before the plan: excluded from installment allocation. */
  @Column({ name: 'paid_before_plan', type: 'decimal', precision: 18, scale: 4, default: 0 })
  paidBeforePlan: number;

  @Column({ name: 'paid_amount', type: 'decimal', precision: 18, scale: 4, default: 0 })
  paidAmount: number;

  @Column({ type: 'enum', enum: InstallmentPlanStatus, default: InstallmentPlanStatus.ACTIVE })
  status: InstallmentPlanStatus;

  @Column({ nullable: true })
  notes: string;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @ManyToOne(() => Customer)
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  @ManyToOne(() => SalesInvoice)
  @JoinColumn({ name: 'invoice_id' })
  invoice: SalesInvoice;

  @OneToMany(() => Installment, (i) => i.plan, { cascade: true })
  installments: Installment[];
}

@Entity('installments')
export class Installment extends BaseEntity {
  @Column({ name: 'plan_id', type: 'uuid' })
  planId: string;

  /** 0 = down payment, then 1..n. */
  @Column({ type: 'int' })
  sequence: number;

  @Column({ name: 'due_date', type: 'date' })
  dueDate: string;

  @Column({ type: 'decimal', precision: 18, scale: 4 })
  amount: number;

  @Column({ name: 'paid_amount', type: 'decimal', precision: 18, scale: 4, default: 0 })
  paidAmount: number;

  @Column({ type: 'enum', enum: InstallmentStatus, default: InstallmentStatus.DUE })
  status: InstallmentStatus;

  @ManyToOne(() => InstallmentPlan, (p) => p.installments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'plan_id' })
  plan: InstallmentPlan;
}
