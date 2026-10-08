import { Entity, Column, Unique } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

@Entity('hr_leave_types')
@Unique(['tenantId', 'code'])
export class LeaveType extends TenantBaseEntity {
  @Column()
  code: string;

  @Column()
  name: string;

  @Column({ name: 'name_ar', nullable: true })
  nameAr: string;

  @Column({ name: 'is_paid', default: true })
  isPaid: boolean;

  /** Days per year; 0 = no balance tracking (e.g. unpaid leave). */
  @Column({ name: 'annual_entitlement', type: 'decimal', precision: 6, scale: 2, default: 0 })
  annualEntitlement: number;

  /**
   * Higher entitlement after a number of service years (Egypt: 30 days after
   * 10 years; Saudi: 30 days after 5 years).
   */
  @Column({
    name: 'senior_entitlement',
    type: 'decimal',
    precision: 6,
    scale: 2,
    nullable: true,
  })
  seniorEntitlement: number | null;

  @Column({ name: 'senior_after_years', type: 'int', nullable: true })
  seniorAfterYears: number | null;

  /** Allow approving requests beyond the remaining balance. */
  @Column({ name: 'allow_negative', default: false })
  allowNegative: boolean;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}
