import { Entity, Column, Unique } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { LeaveAccrualMethod } from '../calculators/leave-calculator';

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

  /** annual = full entitlement on 1 January; monthly = earned at each month end. */
  @Column({ name: 'accrual_method', type: 'varchar', default: 'annual' })
  accrualMethod: LeaveAccrualMethod;

  /** Unused days are carried into the next year. */
  @Column({ name: 'carry_forward', default: false })
  carryForward: boolean;

  /** Maximum days carried into the next year; null = unlimited. */
  @Column({ name: 'carry_forward_max', type: 'decimal', precision: 6, scale: 2, nullable: true })
  carryForwardMax: number | null;

  /** Carried days expire after this many months of the new year; null = never. */
  @Column({ name: 'carry_forward_expiry_months', type: 'int', nullable: true })
  carryForwardExpiryMonths: number | null;

  @Column({ name: 'allow_half_day', default: true })
  allowHalfDay: boolean;

  /** The remaining balance can be paid out (encashment / end of service). */
  @Column({ default: false })
  encashable: boolean;
}
