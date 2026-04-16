import { Entity, Column } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

@Entity('budgets')
export class Budget extends TenantBaseEntity {
  @Column({ name: 'fiscal_year_id', type: 'uuid' })
  fiscalYearId: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId: string;

  @Column({ name: 'cost_center_id', type: 'uuid', nullable: true })
  costCenterId: string;

  @Column({ default: 'monthly' })
  period: 'monthly' | 'quarterly' | 'annual';

  @Column({ type: 'decimal', precision: 18, scale: 4 })
  amount: number;
}
