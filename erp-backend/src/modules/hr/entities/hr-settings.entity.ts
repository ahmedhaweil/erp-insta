import { Entity, Column, Unique } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { DeepPartial, PayrollRules } from '../calculators/payroll-rules';

/** Per-tenant overrides of the statutory payroll rules (rates change yearly). */
@Entity('hr_settings')
@Unique(['tenantId'])
export class HrSettings extends TenantBaseEntity {
  @Column({ type: 'jsonb', default: () => "'{}'" })
  rules: DeepPartial<PayrollRules>;
}
