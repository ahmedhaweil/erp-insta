import { Entity, Column } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

@Entity('customers')
export class Customer extends TenantBaseEntity {
  @Column()
  code: string;

  @Column({ name: 'name_ar' })
  nameAr: string;

  @Column({ name: 'name_en', nullable: true })
  nameEn: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  email: string;

  @Column({ name: 'tax_id', nullable: true })
  taxId: string;

  @Column({ nullable: true })
  address: string;

  @Column({ nullable: true })
  city: string;

  @Column({ nullable: true })
  country: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'credit_limit', type: 'decimal', precision: 18, scale: 4, default: 0 })
  creditLimit: number;

  /** Outstanding receivable (posted invoices minus credit notes and payments). */
  @Column({ type: 'decimal', precision: 18, scale: 4, default: 0 })
  balance: number;

  /** Payment terms in days; drives the default invoice due date. */
  @Column({ name: 'payment_term_days', type: 'int', default: 0 })
  paymentTermDays: number;

  /** Customer group / category (drives the default price list). */
  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId: string | null;

  /** Price list of the customer; overrides the category price list. */
  @Column({ name: 'price_list_id', type: 'uuid', nullable: true })
  priceListId: string | null;

  /** Default sales representative proposed on orders and invoices. */
  @Column({ name: 'sales_rep_id', type: 'uuid', nullable: true })
  salesRepId: string | null;
}
