import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { BaseEntity } from '@shared/entities/base.entity';

export enum RecurringFrequency {
  MONTHLY = 'monthly',
  QUARTERLY = 'quarterly',
  YEARLY = 'yearly',
  /** Every `intervalDays` days. */
  DAYS = 'days',
}

export enum RecurringEntryStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
  /** Past its end date (or cancelled): no more runs. */
  DONE = 'done',
}

/**
 * A recurring journal entry template (rent, subscriptions, accruals...).
 * Each run generates one entry dated on the run date; runs are recorded in
 * `recurring_entry_runs` with a unique (template, run date) key, so running
 * twice never duplicates an entry.
 */
@Entity('recurring_entries')
export class RecurringEntry extends TenantBaseEntity {
  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;

  /** Journal of the generated entries; defaults to the general journal. */
  @Column({ name: 'journal_id', type: 'uuid', nullable: true })
  journalId: string | null;

  @Column({ type: 'enum', enum: RecurringFrequency, default: RecurringFrequency.MONTHLY })
  frequency: RecurringFrequency;

  @Column({ name: 'interval_days', nullable: true })
  intervalDays: number | null;

  @Column({ name: 'start_date', type: 'date' })
  startDate: string;

  @Column({ name: 'end_date', type: 'date', nullable: true })
  endDate: string | null;

  @Column({ name: 'next_run_date', type: 'date', nullable: true })
  nextRunDate: string | null;

  @Column({ name: 'last_run_date', type: 'date', nullable: true })
  lastRunDate: string | null;

  @Column({ name: 'run_count', default: 0 })
  runCount: number;

  /** Post generated entries; otherwise they are left as drafts for review. */
  @Column({ name: 'auto_post', default: true })
  autoPost: boolean;

  @Column({ type: 'enum', enum: RecurringEntryStatus, default: RecurringEntryStatus.ACTIVE })
  status: RecurringEntryStatus;

  @Column({ name: 'currency_id', type: 'uuid', nullable: true })
  currencyId: string | null;

  @Column({ name: 'exchange_rate', type: 'decimal', precision: 12, scale: 6, default: 1 })
  exchangeRate: number;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @OneToMany(() => RecurringEntryLine, (l) => l.template, { cascade: true, eager: true })
  lines: RecurringEntryLine[];
}

@Entity('recurring_entry_lines')
export class RecurringEntryLine extends BaseEntity {
  @Column({ name: 'template_id', type: 'uuid' })
  templateId: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId: string;

  @Column({ type: 'decimal', precision: 18, scale: 4, default: 0 })
  debit: number;

  @Column({ type: 'decimal', precision: 18, scale: 4, default: 0 })
  credit: number;

  @Column({ nullable: true })
  description: string;

  @Column({ name: 'cost_center_id', type: 'uuid', nullable: true })
  costCenterId: string | null;

  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string | null;

  @ManyToOne(() => RecurringEntry, (t) => t.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'template_id' })
  template: RecurringEntry;
}

/** One generated occurrence; the unique index makes generation idempotent. */
@Entity('recurring_entry_runs')
@Index(['tenantId', 'templateId', 'runDate'], { unique: true })
export class RecurringEntryRun extends TenantBaseEntity {
  @Column({ name: 'template_id', type: 'uuid' })
  templateId: string;

  @Column({ name: 'run_date', type: 'date' })
  runDate: string;

  @Column({ name: 'entry_id', type: 'uuid' })
  entryId: string;
}
