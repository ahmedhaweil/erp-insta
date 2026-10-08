import { Entity, Column, Index } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { HrPaymentMethod } from './employee-loan.entity';

export enum FinalSettlementStatus {
  DRAFT = 'draft',
  POSTED = 'posted',
  PAID = 'paid',
  CANCELLED = 'cancelled',
}

export type SettlementReason =
  | 'termination'
  | 'contract_end'
  | 'resignation'
  | 'resignation_article_87'
  | 'dismissal_article_80';

export interface SettlementItem {
  description: string;
  amount: number;
}

/**
 * Final settlement (مخالصة نهائية) of a terminated employee: gratuity,
 * encashment of the remaining leave balance, last salary, other items, less
 * the outstanding loan balance. Posting uses the booked EOS provision.
 */
@Entity('hr_final_settlements')
export class FinalSettlement extends TenantBaseEntity {
  @Column({ name: 'settlement_number' })
  settlementNumber: string;

  @Index()
  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  @Column({ name: 'termination_date', type: 'date' })
  terminationDate: string;

  @Column({ type: 'varchar' })
  reason: SettlementReason;

  @Column({ type: 'enum', enum: FinalSettlementStatus, default: FinalSettlementStatus.DRAFT })
  status: FinalSettlementStatus;

  @Column({ name: 'monthly_wage', type: 'decimal', precision: 18, scale: 4, default: 0 })
  monthlyWage: number;

  @Column({ name: 'service_years', type: 'decimal', precision: 8, scale: 4, default: 0 })
  serviceYears: number;

  @Column({ type: 'decimal', precision: 18, scale: 4, default: 0 })
  gratuity: number;

  /** EOS provision booked for the employee and used by this settlement. */
  @Column({ name: 'provision_used', type: 'decimal', precision: 18, scale: 4, default: 0 })
  provisionUsed: number;

  @Column({ name: 'leave_days', type: 'decimal', precision: 8, scale: 2, default: 0 })
  leaveDays: number;

  @Column({ name: 'leave_encashment', type: 'decimal', precision: 18, scale: 4, default: 0 })
  leaveEncashment: number;

  @Column({ name: 'last_salary', type: 'decimal', precision: 18, scale: 4, default: 0 })
  lastSalary: number;

  @Column({ name: 'other_additions', type: 'decimal', precision: 18, scale: 4, default: 0 })
  otherAdditions: number;

  @Column({ name: 'loan_deduction', type: 'decimal', precision: 18, scale: 4, default: 0 })
  loanDeduction: number;

  @Column({ name: 'other_deductions', type: 'decimal', precision: 18, scale: 4, default: 0 })
  otherDeductions: number;

  @Column({ name: 'total_earnings', type: 'decimal', precision: 18, scale: 4, default: 0 })
  totalEarnings: number;

  @Column({ type: 'decimal', precision: 18, scale: 4, default: 0 })
  net: number;

  /** Breakdown: gratuity calc, leave balances, loans, items, recoveries. */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  details: Record<string, any>;

  @Column({ name: 'posting_date', type: 'date', nullable: true })
  postingDate: string | null;

  @Column({ name: 'paid_date', type: 'date', nullable: true })
  paidDate: string | null;

  @Column({ name: 'payment_method', type: 'enum', enum: HrPaymentMethod, nullable: true })
  paymentMethod: HrPaymentMethod | null;

  @Column({ nullable: true })
  notes: string;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;
}
