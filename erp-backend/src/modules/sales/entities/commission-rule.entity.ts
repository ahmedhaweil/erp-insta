import { Entity, Column } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

export enum CommissionBasis {
  /** % of the untaxed share of amounts collected on the rep's invoices. */
  COLLECTED = 'collected',
  /** % of the untaxed invoiced amount net of credit notes. */
  INVOICED = 'invoiced',
}

/**
 * Commission rule. Empty `salesRepId` = every rep, empty `productCategoryId`
 * = every product. The most specific matching scope wins (rep+category >
 * category > rep > global). Several rules of the same scope form target
 * tiers: the rule with the highest `targetAmount` reached by the rep's
 * period total (on that rule's basis) applies.
 */
@Entity('commission_rules')
export class CommissionRule extends TenantBaseEntity {
  @Column()
  name: string;

  @Column({ name: 'sales_rep_id', type: 'uuid', nullable: true })
  salesRepId: string | null;

  @Column({ name: 'product_category_id', type: 'uuid', nullable: true })
  productCategoryId: string | null;

  @Column({ type: 'enum', enum: CommissionBasis, default: CommissionBasis.COLLECTED })
  basis: CommissionBasis;

  /** Commission rate (%). */
  @Column({ type: 'decimal', precision: 7, scale: 4 })
  rate: number;

  /** Period base the rep must reach for this rule (tier) to apply. */
  @Column({ name: 'target_amount', type: 'decimal', precision: 18, scale: 4, default: 0 })
  targetAmount: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}
