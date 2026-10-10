import { Entity, Column, Index } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

/** Dining area / hall (صالة) grouping tables. */
@Entity('restaurant_dining_areas')
export class DiningArea extends TenantBaseEntity {
  @Column({ name: 'name_ar' })
  nameAr: string;

  @Column({ name: 'name_en', nullable: true })
  nameEn: string;

  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}

/**
 * Restaurant table. Occupancy is not stored: a table is occupied while an
 * open ticket references it.
 */
@Entity('restaurant_tables')
@Index(['tenantId', 'name'], { unique: true })
export class RestaurantTable extends TenantBaseEntity {
  @Column()
  name: string;

  @Column({ name: 'area_id', type: 'uuid', nullable: true })
  areaId: string | null;

  @Column({ type: 'int', default: 4 })
  seats: number;

  /** Optional minimum spend (net of tax) for a dine-in ticket on this table. */
  @Column({ name: 'minimum_charge', type: 'decimal', precision: 18, scale: 4, nullable: true })
  minimumCharge: number | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}

@Entity('restaurant_delivery_zones')
export class DeliveryZone extends TenantBaseEntity {
  @Column({ name: 'name_ar' })
  nameAr: string;

  @Column({ name: 'name_en', nullable: true })
  nameEn: string;

  /** Default delivery fee (net of tax) charged for this zone. */
  @Column({ type: 'decimal', precision: 18, scale: 4, default: 0 })
  fee: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}

export enum DriverCommissionBasis {
  SALES = 'sales',
  DELIVERY_FEE = 'delivery_fee',
}

@Entity('restaurant_drivers')
export class Driver extends TenantBaseEntity {
  @Column({ name: 'name_ar' })
  nameAr: string;

  @Column({ name: 'name_en', nullable: true })
  nameEn: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ name: 'commission_percent', type: 'decimal', precision: 7, scale: 4, default: 0 })
  commissionPercent: number;

  @Column({
    name: 'commission_basis',
    type: 'enum',
    enum: DriverCommissionBasis,
    default: DriverCommissionBasis.DELIVERY_FEE,
  })
  commissionBasis: DriverCommissionBasis;

  @Column({ name: 'employee_id', type: 'uuid', nullable: true })
  employeeId: string | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}

/** Delivery aggregator (Talabat, HungerStation, Jahez...). */
@Entity('restaurant_delivery_apps')
export class DeliveryApp extends TenantBaseEntity {
  @Column({ name: 'name_ar' })
  nameAr: string;

  @Column({ name: 'name_en', nullable: true })
  nameEn: string;

  /** Commission the aggregator keeps, % of the ticket's net sales (before tax). */
  @Column({ name: 'commission_percent', type: 'decimal', precision: 7, scale: 4, default: 0 })
  commissionPercent: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}

/** Per-app selling price overriding the product list price. */
@Entity('restaurant_delivery_app_prices')
@Index(['tenantId', 'appId', 'productId'], { unique: true })
export class DeliveryAppPrice extends TenantBaseEntity {
  @Column({ name: 'app_id', type: 'uuid' })
  appId: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ type: 'decimal', precision: 18, scale: 4 })
  price: number;
}
