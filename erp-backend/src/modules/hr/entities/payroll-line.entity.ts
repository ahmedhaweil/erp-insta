import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '@shared/entities/base.entity';
import { PayrollRun } from './payroll-run.entity';
import { PayrollCountry } from './employee.entity';

/** One employee's payslip inside a payroll run. */
@Entity('hr_payroll_lines')
export class PayrollLine extends BaseEntity {
  @Index()
  @Column({ name: 'run_id', type: 'uuid' })
  runId: string;

  @ManyToOne(() => PayrollRun, (r) => r.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id' })
  run: PayrollRun;

  @Index()
  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  @Column({ name: 'employee_code' })
  employeeCode: string;

  @Column({ name: 'employee_name' })
  employeeName: string;

  @Column({ name: 'payroll_country', type: 'enum', enum: PayrollCountry })
  payrollCountry: PayrollCountry;

  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string | null;

  @Column({ name: 'department_id', type: 'uuid', nullable: true })
  departmentId: string | null;

  @Column({ name: 'cost_center_id', type: 'uuid', nullable: true })
  costCenterId: string | null;

  @Column({ type: 'decimal', precision: 18, scale: 4, default: 0 })
  basic: number;

  @Column({ name: 'allowances_total', type: 'decimal', precision: 18, scale: 4, default: 0 })
  allowancesTotal: number;

  @Column({ name: 'overtime_pay', type: 'decimal', precision: 18, scale: 4, default: 0 })
  overtimePay: number;

  @Column({ name: 'additions_total', type: 'decimal', precision: 18, scale: 4, default: 0 })
  additionsTotal: number;

  /** Absence + unpaid leave + late deductions. */
  @Column({
    name: 'attendance_deductions',
    type: 'decimal',
    precision: 18,
    scale: 4,
    default: 0,
  })
  attendanceDeductions: number;

  @Column({ type: 'decimal', precision: 18, scale: 4, default: 0 })
  gross: number;

  @Column({ name: 'insurable_wage', type: 'decimal', precision: 18, scale: 4, default: 0 })
  insurableWage: number;

  @Column({ name: 'employee_si', type: 'decimal', precision: 18, scale: 4, default: 0 })
  employeeSi: number;

  @Column({ name: 'employer_si', type: 'decimal', precision: 18, scale: 4, default: 0 })
  employerSi: number;

  @Column({ name: 'income_tax', type: 'decimal', precision: 18, scale: 4, default: 0 })
  incomeTax: number;

  /** Martyrs fund (Law 4/2021) deducted from the employee. */
  @Column({ name: 'martyrs_fund', type: 'decimal', precision: 18, scale: 4, default: 0 })
  martyrsFund: number;

  /** Martyrs fund borne by the employer. */
  @Column({ name: 'martyrs_fund_employer', type: 'decimal', precision: 18, scale: 4, default: 0 })
  martyrsFundEmployer: number;

  @Column({ name: 'loan_deduction', type: 'decimal', precision: 18, scale: 4, default: 0 })
  loanDeduction: number;

  @Column({ name: 'other_deductions', type: 'decimal', precision: 18, scale: 4, default: 0 })
  otherDeductions: number;

  @Column({ name: 'total_deductions', type: 'decimal', precision: 18, scale: 4, default: 0 })
  totalDeductions: number;

  @Column({ type: 'decimal', precision: 18, scale: 4, default: 0 })
  net: number;

  /** Full calculator breakdown (attendance, rates, allocations...). */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  details: Record<string, any>;
}
