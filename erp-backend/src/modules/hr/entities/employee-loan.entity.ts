import { Entity, Column, Index, OneToMany } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { LoanInstallment } from './loan-installment.entity';

export enum LoanType {
  LOAN = 'loan',
  ADVANCE = 'advance',
}

export enum LoanStatus {
  DRAFT = 'draft',
  DISBURSED = 'disbursed',
  SETTLED = 'settled',
  CANCELLED = 'cancelled',
}

export enum HrPaymentMethod {
  CASH = 'cash',
  BANK = 'bank',
}

/** Employee loan or salary advance (سلفة) recovered through payroll. */
@Entity('hr_employee_loans')
export class EmployeeLoan extends TenantBaseEntity {
  @Column({ name: 'loan_number' })
  loanNumber: string;

  @Index()
  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  @Column({ type: 'enum', enum: LoanType, default: LoanType.LOAN })
  type: LoanType;

  @Column({ type: 'decimal', precision: 18, scale: 4 })
  amount: number;

  @Column({ name: 'installment_count', type: 'int' })
  installmentCount: number;

  /** First payroll month that deducts an installment (YYYY-MM). */
  @Column({ name: 'start_period' })
  startPeriod: string;

  @Column({ name: 'repaid_amount', type: 'decimal', precision: 18, scale: 4, default: 0 })
  repaidAmount: number;

  @Column({ type: 'enum', enum: LoanStatus, default: LoanStatus.DRAFT })
  status: LoanStatus;

  @Column({ name: 'disbursement_date', type: 'date', nullable: true })
  disbursementDate: string | null;

  @Column({ name: 'payment_method', type: 'enum', enum: HrPaymentMethod, nullable: true })
  paymentMethod: HrPaymentMethod | null;

  @Column({ nullable: true })
  notes: string;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @OneToMany(() => LoanInstallment, (i) => i.loan, { cascade: true })
  installments: LoanInstallment[];
}
