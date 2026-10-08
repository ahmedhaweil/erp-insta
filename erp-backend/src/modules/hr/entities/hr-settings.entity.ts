import { Entity, Column, Unique } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { DeepPartial, PayrollRules } from '../calculators/payroll-rules';

/** Per-tenant overrides of the statutory payroll rules (rates change yearly). */
@Entity('hr_settings')
@Unique(['tenantId'])
export class HrSettings extends TenantBaseEntity {
  @Column({ type: 'jsonb', default: () => "'{}'" })
  rules: DeepPartial<PayrollRules>;

  /**
   * HR-specific GL accounts (the shared accounting settings keys are fixed):
   * end-of-service expense / provision and the Martyrs fund payable
   * (falls back to payrollTaxPayable).
   */
  @Column({ name: 'eos_expense_account_id', type: 'uuid', nullable: true })
  eosExpenseAccountId: string | null;

  @Column({ name: 'eos_provision_account_id', type: 'uuid', nullable: true })
  eosProvisionAccountId: string | null;

  @Column({ name: 'martyrs_fund_account_id', type: 'uuid', nullable: true })
  martyrsFundAccountId: string | null;
}
