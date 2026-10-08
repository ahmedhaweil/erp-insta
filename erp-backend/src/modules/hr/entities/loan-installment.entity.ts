import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '@shared/entities/base.entity';
import { EmployeeLoan } from './employee-loan.entity';

@Entity('hr_loan_installments')
export class LoanInstallment extends BaseEntity {
  @Index()
  @Column({ name: 'loan_id', type: 'uuid' })
  loanId: string;

  @ManyToOne(() => EmployeeLoan, (l) => l.installments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'loan_id' })
  loan: EmployeeLoan;

  @Column({ type: 'int' })
  sequence: number;

  /** Payroll month the installment is due (YYYY-MM). */
  @Column({ name: 'due_period' })
  duePeriod: string;

  @Column({ type: 'decimal', precision: 18, scale: 4 })
  amount: number;

  /** Amount recovered through approved payrolls. */
  @Column({ name: 'paid_amount', type: 'decimal', precision: 18, scale: 4, default: 0 })
  paidAmount: number;
}
