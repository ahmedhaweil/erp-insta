import { Entity, Column } from 'typeorm';
import { PromotionRuleBase } from './promotion-rule-base.entity';
import { BonusTier } from '../engine/promotion-engine';

/** Bonus / buy X get Y (Instasoft disc_pouns). */
@Entity('promotion_bonus_rules')
export class PromotionBonusRule extends PromotionRuleBase {
  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  /** Only quantities sold in this unit count; null = any unit. */
  @Column({ name: 'unit_id', type: 'uuid', nullable: true })
  unitId: string | null;

  /** Product given free; null = the purchased product. */
  @Column({ name: 'free_product_id', type: 'uuid', nullable: true })
  freeProductId: string | null;

  /** [{ minQty, freeQty }]; the highest tier reached applies. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  tiers: BonusTier[];

  /** Free quantity per multiple of minQty (default: once). */
  @Column({ default: false })
  repeat: boolean;
}
