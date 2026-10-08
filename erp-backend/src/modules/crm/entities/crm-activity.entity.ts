import { Entity, Column, Index } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

export enum ActivityType {
  CALL = 'call',
  MEETING = 'meeting',
  TASK = 'task',
  EMAIL = 'email',
}

export enum ActivityStatus {
  PLANNED = 'planned',
  DONE = 'done',
  CANCELLED = 'cancelled',
}

/** Scheduled activity on a lead or customer (Odoo mail.activity / المتابعات). */
@Entity('crm_activities')
@Index(['tenantId', 'assignedUserId', 'status'])
export class CrmActivity extends TenantBaseEntity {
  @Column({ type: 'enum', enum: ActivityType })
  type: ActivityType;

  @Column()
  subject: string;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ name: 'due_date', type: 'date' })
  dueDate: string;

  @Column({ name: 'lead_id', type: 'uuid', nullable: true })
  leadId: string;

  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId: string;

  @Column({ name: 'assigned_user_id', type: 'uuid' })
  assignedUserId: string;

  @Column({ type: 'enum', enum: ActivityStatus, default: ActivityStatus.PLANNED })
  status: ActivityStatus;

  @Column({ name: 'done_at', type: 'timestamptz', nullable: true })
  doneAt: Date;

  @Column({ type: 'text', nullable: true })
  result: string;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;
}
