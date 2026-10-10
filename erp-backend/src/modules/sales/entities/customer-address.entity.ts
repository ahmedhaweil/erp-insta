import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { Customer } from './customer.entity';

/** Delivery address of a customer (a customer can have several, one default). */
@Entity('customer_addresses')
export class CustomerAddress extends TenantBaseEntity {
  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  /** e.g. "Head office", "Warehouse 2". */
  @Column()
  label: string;

  @Column()
  address: string;

  @Column({ type: 'varchar', nullable: true })
  city: string | null;

  /** Free-text delivery zone / area used for route planning. */
  @Column({ name: 'delivery_zone', type: 'varchar', nullable: true })
  deliveryZone: string | null;

  @Column({ type: 'varchar', nullable: true })
  phone: string | null;

  @Column({ name: 'is_default', default: false })
  isDefault: boolean;

  @ManyToOne(() => Customer, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;
}
