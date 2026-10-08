import { Entity, Column, Index } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

export enum OvertimeRequestStatus {
  DRAFT = 'draft',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled',
}

/** Overtime to be paid by payroll once approved (see general.overtimeMode). */
@Entity('hr_overtime_requests')
export class OvertimeRequest extends TenantBaseEntity {
  @Index()
  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  @Index()
  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'decimal', precision: 6, scale: 2 })
  hours: number;

  @Column({ nullable: true })
  reason: string;

  @Column({ type: 'enum', enum: OvertimeRequestStatus, default: OvertimeRequestStatus.DRAFT })
  status: OvertimeRequestStatus;

  @Column({ name: 'decided_by', type: 'uuid', nullable: true })
  decidedBy: string | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  @Column({ name: 'decision_note', type: 'varchar', nullable: true })
  decisionNote: string | null;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;
}
