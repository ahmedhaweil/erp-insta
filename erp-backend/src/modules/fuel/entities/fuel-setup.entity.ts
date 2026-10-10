import { Entity, Column } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

/**
 * Underground tank holding one fuel product. Its stock is the product's stock
 * in the tank's own warehouse (one tank per warehouse + product), so the
 * inventory module values it and receives purchases into it.
 */
@Entity('fuel_tanks')
export class FuelTank extends TenantBaseEntity {
  @Column({ name: 'name_ar' })
  nameAr: string;

  @Column({ name: 'name_en', nullable: true })
  nameEn: string;

  @Column({ name: 'fuel_product_id', type: 'uuid' })
  fuelProductId: string;

  @Column({ name: 'warehouse_id', type: 'uuid' })
  warehouseId: string;

  /** Capacity in liters (product base unit). */
  @Column({ type: 'decimal', precision: 18, scale: 4 })
  capacity: number;

  /** Low-level alert threshold in liters; null = no alert. */
  @Column({ name: 'min_level', type: 'decimal', precision: 18, scale: 4, nullable: true })
  minLevel: number | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}

@Entity('fuel_pumps')
export class FuelPump extends TenantBaseEntity {
  @Column({ name: 'name_ar' })
  nameAr: string;

  @Column({ name: 'name_en', nullable: true })
  nameEn: string;

  /** Station (branch) the pump stands in. */
  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}

/** Hose of a pump drawing from one tank, with its totaliser meter. */
@Entity('fuel_nozzles')
export class FuelNozzle extends TenantBaseEntity {
  @Column({ name: 'pump_id', type: 'uuid' })
  pumpId: string;

  @Column({ name: 'tank_id', type: 'uuid' })
  tankId: string;

  @Column({ name: 'name_ar' })
  nameAr: string;

  @Column({ name: 'name_en', nullable: true })
  nameEn: string;

  @Column({ name: 'current_reading', type: 'decimal', precision: 18, scale: 4, default: 0 })
  currentReading: number;

  /** Pump price (VAT included) overriding the product sales price. */
  @Column({ name: 'price_override', type: 'decimal', precision: 18, scale: 4, nullable: true })
  priceOverride: number | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}
