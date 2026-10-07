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

  /** Residual value that is never depreciated. */
  @Column({ name: 'salvage_value', type: 'decimal', precision: 18, scale: 4, default: 0 })
  salvageValue: number;

  /** Annual rate (%) used by the declining-balance method. */
  @Column({ name: 'declining_rate', type: 'decimal', precision: 5, scale: 2, default: 0 })
  decliningRate: number;

  /** Last month-end for which depreciation was posted. */
  @Column({ name: 'last_depreciation_date', type: 'date', nullable: true })
  lastDepreciationDate: string;

  @Column({ name: 'depreciation_expense_account_id', type: 'uuid', nullable: true })
  depreciationExpenseAccountId: string;

  @Column({ name: 'accumulated_depreciation_account_id', type: 'uuid', nullable: true })
  accumulatedDepreciationAccountId: string;

  @Column({ name: 'disposal_date', type: 'date', nullable: true })
  disposalDate: string;

  @Column({ name: 'disposal_amount', type: 'decimal', precision: 18, scale: 4, nullable: true })
  disposalAmount: number;
}
