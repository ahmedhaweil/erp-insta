import { Entity, Column, Unique } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

/** Per-tenant defaults of the repair / service center. */
@Entity('maintenance_settings')
@Unique(['tenantId'])
export class MaintenanceSettings extends TenantBaseEntity {
  /** Service product used on invoices for labour lines without their own product. */
  @Column({ name: 'default_labour_product_id', type: 'uuid', nullable: true })
  defaultLabourProductId: string | null;

  /** Warehouse spare parts are reserved and issued from. */
  @Column({ name: 'default_warehouse_id', type: 'uuid', nullable: true })
  defaultWarehouseId: string | null;

  /** Customer invoiced for walk-in tickets that have no customer record. */
  @Column({ name: 'walk_in_customer_id', type: 'uuid', nullable: true })
  walkInCustomerId: string | null;

  /** Ticket line prices include VAT (passed to the sales invoice). */
  @Column({ name: 'prices_include_tax', default: false })
  pricesIncludeTax: boolean;
}
