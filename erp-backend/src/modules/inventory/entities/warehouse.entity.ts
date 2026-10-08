import { Entity, Column } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

@Entity('warehouses')
export class Warehouse extends TenantBaseEntity {
  @Column()
  code: string;

  @Column({ name: 'name_ar' })
  nameAr: string;

  @Column({ name: 'name_en', nullable: true })
  nameEn: string;

  @Column({ name: 'branch_id', type: 'uuid' })
  branchId: string;

  @Column({ nullable: true })
  address: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  /**
   * Per-warehouse negative stock policy: true allows, false blocks, null
   * follows the tenant setting (`tenants.settings.inventory.allowNegativeStock`).
   */
  @Column({ name: 'allow_negative_stock', type: 'boolean', nullable: true })
  allowNegativeStock: boolean | null;
}
