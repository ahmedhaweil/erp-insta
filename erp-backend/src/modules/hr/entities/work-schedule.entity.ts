import { Entity, Column, Unique } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

/** Working pattern assigned to employees (daily hours, start time, weekend). */
@Entity('hr_work_schedules')
@Unique(['tenantId', 'name'])
export class WorkSchedule extends TenantBaseEntity {
  @Column()
  name: string;

  @Column({ name: 'daily_hours', type: 'decimal', precision: 5, scale: 2, default: 8 })
  dailyHours: number;

  /** Shift start (HH:mm), used to compute late minutes. */
  @Column({ name: 'start_time', default: '09:00' })
  startTime: string;

  /** 0 = Sunday ... 6 = Saturday. Default Friday + Saturday. */
  @Column({ name: 'weekend_days', type: 'int', array: true, default: '{5,6}' })
  weekendDays: number[];

  @Column({ name: 'grace_minutes', type: 'int', default: 0 })
  graceMinutes: number;

  /** Used for employees without an explicit schedule. */
  @Column({ name: 'is_default', default: false })
  isDefault: boolean;
}
