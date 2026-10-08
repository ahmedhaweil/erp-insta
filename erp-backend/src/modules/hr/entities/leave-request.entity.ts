import { Entity, Column, Index } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

export enum LeaveRequestStatus {
  DRAFT = 'draft',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled',
}

@Entity('hr_leave_requests')
export class LeaveRequest extends TenantBaseEntity {
  @Column({ name: 'request_number' })
  requestNumber: string;

  @Index()
  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  @Column({ name: 'leave_type_id', type: 'uuid' })
  leaveTypeId: string;

  @Column({ name: 'start_date', type: 'date' })
  startDate: string;

  @Column({ name: 'end_date', type: 'date' })
  endDate: string;

  /** Working days covered (weekends and public holidays excluded). */
  @Column({ type: 'decimal', precision: 6, scale: 2 })
  days: number;

  @Column({ nullable: true })
  reason: string;

  @Column({ type: 'enum', enum: LeaveRequestStatus, default: LeaveRequestStatus.DRAFT })
  status: LeaveRequestStatus;

  @Column({ name: 'decided_by', type: 'uuid', nullable: true })
  decidedBy: string | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  @Column({ name: 'decision_note', type: 'varchar', nullable: true })
  decisionNote: string | null;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;
}
