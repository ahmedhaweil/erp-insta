import { Entity, Column } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

@Entity('fixed_assets')
export class FixedAsset extends TenantBaseEntity {
  @Column()
  code: string;

  @Column()
  name: string;

  @Column({ name: 'purchase_date', type: 'date' })
  purchaseDate: string;

  @Column({ name: 'purchase_value', type: 'decimal', precision: 18, scale: 4 })
  purchaseValue: number;

  @Column({ name: 'useful_life_months' })
  usefulLifeMonths: number;

  @Column({ name: 'depreciation_method', default: 'straight_line' })
  depreciationMethod: string;

  @Column({ name: 'account_id', type: 'uuid', nullable: true })
  accountId: string;

  @Column({
    name: 'accumulated_depreciation',
    type: 'decimal',
    precision: 18,
    scale: 4,
    default: 0,
  })
  accumulatedDepreciation: number;

  @Column({ name: 'is_disposed', default: false })
  isDisposed: boolean;
}
