import { Entity, Column } from 'typeorm';
import { PromotionRuleBase } from './promotion-rule-base.entity';
import { DiscountType } from '../engine/promotion-engine';

/** Item campaign (Instasoft disc_item): % or amount per unit off products / categories. */
@Entity('promotion_campaigns')
export class PromotionCampaign extends PromotionRuleBase {
  @Column({ name: 'product_ids', type: 'uuid', array: true, default: '{}' })
  productIds: string[];

  /** Categories (their sub-categories included). */
  @Column({ name: 'category_ids', type: 'uuid', array: true, default: '{}' })
  categoryIds: string[];

  @Column({ name: 'discount_type', default: 'percent' })
  discountType: DiscountType;

  /** Percent (0-100) or fixed amount per unit. */
  @Column({ type: 'decimal', precision: 18, scale: 4 })
  value: number;
}
