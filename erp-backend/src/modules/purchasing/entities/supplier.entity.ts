import { Entity, Column } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

@Entity('suppliers')
export class Supplier extends TenantBaseEntity {
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

  /** Outstanding payable (posted bills minus refunds and payments). */
  @Column({ type: 'decimal', precision: 18, scale: 4, default: 0 })
  balance: number;

  /** Payment terms in days; drives the default bill due date. */
  @Column({ name: 'payment_term_days', type: 'int', default: 0 })
  paymentTermDays: number;
}
