import { Entity, Column, Unique } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

/** Paid public holiday; not counted as a working day by attendance or leaves. */
@Entity('hr_public_holidays')
@Unique(['tenantId', 'date'])
export class PublicHoliday extends TenantBaseEntity {
  @Column({ type: 'date' })
  date: string;

  @Column()
  name: string;
}
