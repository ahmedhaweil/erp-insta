import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { BaseEntity } from '@shared/entities/base.entity';

export enum DeferralType {
  /** Deferred (unearned) revenue: Dr deferral liability / Cr revenue each month. */
  REVENUE = 'revenue',
  /** Prepaid expense: Dr expense / Cr prepaid asset each month. */
  EXPENSE = 'expense',
}

export enum DeferralStatus {
  ACTIVE = 'active',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

/**
 * Deferred revenue / prepaid expense recognised monthly over `months`
 * months starting with the start month (Odoo deferred revenue/expense
 * entries). Each line is posted once; the line's entry id is the
 * idempotency key.
 */
@Entity('deferral_schedules')
export class DeferralSchedule extends TenantBaseEntity {
  @Column({ name: 'schedule_number' })
  scheduleNumber: string;

  @Column({ type: 'enum', enum: DeferralType })
  type: DeferralType;

  @Column()
  name: string;

  @Column({ nullable: true })
  reference: string;

  /** Total amount to recognise (base currency). */
  @Column({ type: 'decimal', precision: 18, scale: 4 })
  amount: number;

  /** Balance-sheet account: deferred revenue (liability) or prepaid expense (asset). */
  @Column({ name: 'deferral_account_id', type: 'uuid' })
  deferralAccountId: string;

  /** P&L account recognised each month (revenue or expense). */
  @Column({ name: 'pl_account_id', type: 'uuid' })
  plAccountId: string;

  /** Account credited/debited by the optional initial entry (cash, bank, receivable...). */
  @Column({ name: 'counterpart_account_id', type: 'uuid', nullable: true })
  counterpartAccountId: string | null;

  @Column({ name: 'initial_entry_id', type: 'uuid', nullable: true })
  initialEntryId: string | null;

  @Column({ name: 'start_date', type: 'date' })
  startDate: string;

  @Column()
  months: number;

  @Column({ name: 'recognized_amount', type: 'decimal', precision: 18, scale: 4, default: 0 })
  recognizedAmount: number;

  @Column({ type: 'enum', enum: DeferralStatus, default: DeferralStatus.ACTIVE })
  status: DeferralStatus;

  @Column({ name: 'cost_center_id', type: 'uuid', nullable: true })
  costCenterId: string | null;

  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string | null;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @OneToMany(() => DeferralScheduleLine, (l) => l.schedule, { cascade: true })
  lines: DeferralScheduleLine[];
}

export enum DeferralLineStatus {
  PLANNED = 'planned',
  POSTED = 'posted',
  CANCELLED = 'cancelled',
}

@Entity('deferral_schedule_lines')
@Index(['scheduleId', 'sequence'], { unique: true })
export class DeferralScheduleLine extends BaseEntity {
  @Column({ name: 'schedule_id', type: 'uuid' })
  scheduleId: string;

  @Column()
  sequence: number;

  /** Month-end recognition date. */
  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'decimal', precision: 18, scale: 4 })
  amount: number;

  @Column({ type: 'enum', enum: DeferralLineStatus, default: DeferralLineStatus.PLANNED })
  status: DeferralLineStatus;

  @Column({ name: 'entry_id', type: 'uuid', nullable: true })
  entryId: string | null;

  @ManyToOne(() => DeferralSchedule, (s) => s.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'schedule_id' })
  schedule: DeferralSchedule;
}
