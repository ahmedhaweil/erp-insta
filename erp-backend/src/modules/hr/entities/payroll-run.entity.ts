import { Entity, Column, OneToMany } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { PayrollLine } from './payroll-line.entity';
import { HrPaymentMethod } from './employee-loan.entity';

export enum PayrollRunStatus {
  DRAFT = 'draft',
  APPROVED = 'approved',
  PAID = 'paid',
  CANCELLED = 'cancelled',
  REVERSED = 'reversed',
}

@Entity('hr_payroll_runs')
export class PayrollRun extends TenantBaseEntity {
  @Column({ name: 'run_number' })
  runNumber: string;

  /** YYYY-MM */
  @Column()
  period: string;

  @Column({ name: 'period_start', type: 'date' })
  periodStart: string;

  @Column({ name: 'period_end', type: 'date' })
  periodEnd: string;

  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string | null;

  @Column({ name: 'department_id', type: 'uuid', nullable: true })
  departmentId: string | null;

  @Column({ type: 'enum', enum: PayrollRunStatus, default: PayrollRunStatus.DRAFT })
  status: PayrollRunStatus;

  @Column({ name: 'employee_count', type: 'int', default: 0 })
  employeeCount: number;

  @Column({ name: 'total_gross', type: 'decimal', precision: 18, scale: 4, default: 0 })
  totalGross: number;

  @Column({ name: 'total_employee_si', type: 'decimal', precision: 18, scale: 4, default: 0 })
  totalEmployeeSi: number;

  @Column({ name: 'total_employer_si', type: 'decimal', precision: 18, scale: 4, default: 0 })
  totalEmployerSi: number;

  @Column({ name: 'total_tax', type: 'decimal', precision: 18, scale: 4, default: 0 })
  totalTax: number;

  @Column({ name: 'total_loans', type: 'decimal', precision: 18, scale: 4, default: 0 })
  totalLoans: number;

  @Column({
    name: 'total_other_deductions',
    type: 'decimal',
    precision: 18,
    scale: 4,
    default: 0,
  })
  totalOtherDeductions: number;

  @Column({ name: 'total_net', type: 'decimal', precision: 18, scale: 4, default: 0 })
  totalNet: number;

  @Column({ name: 'computed_at', type: 'timestamptz', nullable: true })
  computedAt: Date | null;

  @Column({ name: 'approved_by', type: 'uuid', nullable: true })
  approvedBy: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  /** Accounting date of the accrual entry. */
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

  @OneToMany(() => PayrollLine, (l) => l.run, { cascade: true })
  lines: PayrollLine[];
}
