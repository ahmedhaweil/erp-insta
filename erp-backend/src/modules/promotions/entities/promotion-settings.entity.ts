import { Entity, Column, Index } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

/** Per-tenant promotion / discount settings. */
@Entity('promotion_settings')
@Index(['tenantId'], { unique: true })
export class PromotionSettings extends TenantBaseEntity {
  /**
   * Largest manual discount (line + invoice discounts, as % of the gross
   * amount) allowed without promotions/discounts/override. Null = no limit.
   * Promotion discounts are not counted.
   */
  @Column({
    name: 'max_total_discount_percent',
    type: 'decimal',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  maxTotalDiscountPercent: number | null;
}
