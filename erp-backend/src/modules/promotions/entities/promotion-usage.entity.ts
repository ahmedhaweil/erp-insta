import { Entity, Column, Index } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { PromotionRuleType } from '../engine/promotion-engine';

export type PromotionDocumentType = 'pos_order' | 'sales_invoice' | 'sales_order';

/** One promotion applied on one document (source of the cost report). */
@Entity('promotion_usages')
@Index(['tenantId', 'documentType', 'documentId'])
export class PromotionUsage extends TenantBaseEntity {
  @Column({ name: 'rule_type' })
  ruleType: PromotionRuleType;

  @Column({ name: 'rule_id', type: 'uuid' })
  ruleId: string;

  @Column({ name: 'document_type' })
  documentType: PromotionDocumentType;

  @Column({ name: 'document_id', type: 'uuid' })
  documentId: string;

  @Column({ type: 'date' })
  date: string;

  /** Discount given; for a bonus, the value of the free goods at the document price. */
  @Column({ name: 'discount_amount', type: 'decimal', precision: 18, scale: 4, default: 0 })
  discountAmount: number;

  /** Free quantity given (bonus rules). */
  @Column({ name: 'bonus_qty', type: 'decimal', precision: 18, scale: 4, default: 0 })
  bonusQty: number;

  /** Set when the document is cancelled; voided usages leave the cost report. */
  @Column({ name: 'is_void', default: false })
  isVoid: boolean;
}
