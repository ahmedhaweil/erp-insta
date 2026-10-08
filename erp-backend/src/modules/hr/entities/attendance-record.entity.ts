import { Entity, Column, Unique } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

export enum AttendanceSource {
  MANUAL = 'manual',
  IMPORT = 'import',
}

@Entity('hr_attendance_records')
@Unique(['tenantId', 'employeeId', 'date'])
export class AttendanceRecord extends TenantBaseEntity {
  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  @Column({ type: 'date' })
  date: string;

  /** HH:mm */
  @Column({ name: 'check_in', type: 'varchar', nullable: true })
  checkIn: string | null;

  /** HH:mm; earlier than check-in means an overnight shift. */
  @Column({ name: 'check_out', type: 'varchar', nullable: true })
  checkOut: string | null;

  @Column({ type: 'enum', enum: AttendanceSource, default: AttendanceSource.MANUAL })
  source: AttendanceSource;

  @Column({ nullable: true })
  notes: string;
}
