import { Entity, Column, Index } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

export enum LeaveEncashmentStatus {
  APPROVED = 'approved',
  CANCELLED = 'cancelled',
}

/**
 * Leave encashment (صرف رصيد الإجازات): unused leave days paid out through
 * payroll as a taxable addition of the chosen month.
 */
@Entity('hr_leave_encashments')
export class LeaveEncashment extends TenantBaseEntity {
  @Index()
  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  @Column({ name: 'leave_type_id', type: 'uuid' })
  leaveTypeId: string;

  /** Leave year whose balance is encashed. */
  @Column({ type: 'int' })
  year: number;

  @Column({ type: 'decimal', precision: 6, scale: 2 })
  days: number;

  @Column({ name: 'daily_rate', type: 'decimal', precision: 18, scale: 4 })
  dailyRate: number;

  @Column({ type: 'decimal', precision: 18, scale: 4 })
  amount: number;

  /** Payroll month paying it (YYYY-MM). */
  @Column()
  period: string;

  @Column({ type: 'enum', enum: LeaveEncashmentStatus, default: LeaveEncashmentStatus.APPROVED })
  status: LeaveEncashmentStatus;

  /** The payroll addition created for it. */
  @Column({ name: 'payroll_adjustment_id', type: 'uuid', nullable: true })
  payrollAdjustmentId: string | null;

  @Column({ nullable: true })
  notes: string;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;
}
