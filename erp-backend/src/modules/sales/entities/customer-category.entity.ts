import { Entity, Column } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

/** Customer group (e.g. wholesale, retail, distributors) with a default price list. */
@Entity('customer_categories')
export class CustomerCategory extends TenantBaseEntity {
  @Column()
  code: string;

  @Column({ name: 'name_ar' })
  nameAr: string;

  @Column({ name: 'name_en', nullable: true })
  nameEn: string;

  @Column({ name: 'price_list_id', type: 'uuid', nullable: true })
  priceListId: string | null;

  /** Default soft balance threshold of the category's customers (warning only). */
  @Column({ name: 'balance_warning_threshold', type: 'decimal', precision: 18, scale: 4, nullable: true })
  balanceWarningThreshold: number | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}
