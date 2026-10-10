import { Entity, Column } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

@Entity('customers')
export class Customer extends TenantBaseEntity {
  @Column()
  code: string;

  @Column({ name: 'name_ar' })
  nameAr: string;

  @Column({ name: 'name_en' })
  nameEn: string;

  @Column()
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

  /**
   * Soft limit: posting a sale that takes the balance above it succeeds but
   * returns a warning. Null = use the customer category threshold.
   */
  @Column({ name: 'balance_warning_threshold', type: 'decimal', precision: 18, scale: 4, nullable: true })
  balanceWarningThreshold: number | null;

  /** Blocked (rejected) customer: no new orders, invoices or POS sales. */
  @Column({ name: 'is_blocked', default: false })
  isBlocked: boolean;

  @Column({ name: 'block_reason', type: 'varchar', nullable: true })
  blockReason: string | null;

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
