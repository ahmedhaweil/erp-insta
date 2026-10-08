import { Entity, Column, OneToMany } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { PriceListRule } from './price-list-rule.entity';

/** Named price list (e.g. "Wholesale 2026"). */
@Entity('price_lists')
export class PriceList extends TenantBaseEntity {
  @Column()
  name: string;

  /** Currency the list's fixed prices are expressed in (null = base currency). */
  @Column({ name: 'currency_id', type: 'uuid', nullable: true })
  currencyId: string | null;

  @Column({ name: 'valid_from', type: 'date', nullable: true })
  validFrom: string | null;

  @Column({ name: 'valid_to', type: 'date', nullable: true })
  validTo: string | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ nullable: true })
  notes: string;

  @OneToMany(() => PriceListRule, (rule) => rule.priceList, { cascade: true })
  rules: PriceListRule[];
}
