import { Entity, Column } from 'typeorm';
import { PromotionRuleBase } from './promotion-rule-base.entity';
import { DiscountType, PaymentConditionRule } from '../engine/promotion-engine';

/** Invoice-total discount (Instasoft disc_fat). */
@Entity('promotion_invoice_discounts')
export class PromotionInvoiceDiscount extends PromotionRuleBase {
  @Column({ name: 'discount_type', default: 'percent' })
  discountType: DiscountType;

  @Column({ type: 'decimal', precision: 18, scale: 4 })
  value: number;

  /** Inclusive subtotal band (after line and offer discounts, before tax). */
  @Column({ name: 'min_subtotal', type: 'decimal', precision: 18, scale: 4, default: 0 })
  minSubtotal: number;

  @Column({ name: 'max_subtotal', type: 'decimal', precision: 18, scale: 4, nullable: true })
  maxSubtotal: number | null;

  @Column({ name: 'payment_condition', default: 'any' })
  paymentCondition: PaymentConditionRule;

  /** Lowest number wins when several rules match (then the oldest). */
  @Column({ type: 'int', default: 0 })
  priority: number;
}
