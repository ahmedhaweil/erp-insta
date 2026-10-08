import { Entity, Column, Index } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

export enum AdjustmentKind {
  ADDITION = 'addition',
  DEDUCTION = 'deduction',
}

/** One-off addition (bonus, commission...) or deduction (penalty...) for a payroll month. */
@Entity('hr_payroll_adjustments')
export class PayrollAdjustment extends TenantBaseEntity {
  @Index()
  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  /** YYYY-MM */
  @Index()
  @Column()
  period: string;

  @Column({ type: 'enum', enum: AdjustmentKind })
  kind: AdjustmentKind;

  @Column({ default: 'other' })
  category: string;

  @Column()
  description: string;

  @Column({ type: 'decimal', precision: 18, scale: 4 })
  amount: number;

  /** Egypt: whether an addition is subject to salary tax. */
  @Column({ default: true })
  taxable: boolean;

  /** Set when an approved payroll run consumed the adjustment. */
  @Column({ name: 'payroll_run_id', type: 'uuid', nullable: true })
  payrollRunId: string | null;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;
}
