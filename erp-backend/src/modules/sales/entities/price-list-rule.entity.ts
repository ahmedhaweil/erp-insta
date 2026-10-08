import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '@shared/entities/base.entity';
import { PriceList } from './price-list.entity';

export enum PriceRuleType {
  /** `value` is the unit price. */
  FIXED = 'fixed',
  /** `value` is a % discount on the product sales price. */
  DISCOUNT = 'discount',
  /** `value` is a % markup on the product average cost. */
  MARKUP = 'markup',
}

/**
 * A price list rule applies to one product, to a product category (and its
 * sub-categories), or to every product when both are empty. Quantity tiers
 * are expressed with `minQuantity`.
 */
@Entity('price_list_rules')
export class PriceListRule extends BaseEntity {
  @Column({ name: 'price_list_id', type: 'uuid' })
  priceListId: string;

  @Column({ name: 'product_id', type: 'uuid', nullable: true })
  productId: string | null;

  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId: string | null;

  @Column({ name: 'rule_type', type: 'enum', enum: PriceRuleType })
  ruleType: PriceRuleType;

  @Column({ type: 'decimal', precision: 18, scale: 4 })
  value: number;

  @Column({ name: 'min_quantity', type: 'decimal', precision: 18, scale: 4, default: 0 })
  minQuantity: number;

  @Column({ name: 'valid_from', type: 'date', nullable: true })
  validFrom: string | null;

  @Column({ name: 'valid_to', type: 'date', nullable: true })
  validTo: string | null;

  @ManyToOne(() => PriceList, (list) => list.rules, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'price_list_id' })
  priceList: PriceList;
}
