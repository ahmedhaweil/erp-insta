import { Entity, Column, Index } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

@Entity('restaurant_kitchen_stations')
export class KitchenStation extends TenantBaseEntity {
  @Column({ name: 'name_ar' })
  nameAr: string;

  @Column({ name: 'name_en', nullable: true })
  nameEn: string;

  @Column({ name: 'printer_name', type: 'varchar', nullable: true })
  printerName: string | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}

/**
 * Routing of items to kitchen stations, by product or by category.
 * Product routes override category routes.
 */
@Entity('restaurant_kitchen_routes')
@Index(['tenantId', 'productId'])
@Index(['tenantId', 'categoryId'])
export class KitchenRoute extends TenantBaseEntity {
  @Column({ name: 'station_id', type: 'uuid' })
  stationId: string;

  @Column({ name: 'product_id', type: 'uuid', nullable: true })
  productId: string | null;

  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId: string | null;
}

export enum ModifierType {
  /** Extra (إضافة): adds a price and may consume a stock product. */
  ADDON = 'addon',
  /** Without (بدون): removes an ingredient, may reduce the price. */
  WITHOUT = 'without',
}

@Entity('restaurant_product_modifiers')
@Index(['tenantId', 'productId'])
export class ProductModifier extends TenantBaseEntity {
  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ type: 'enum', enum: ModifierType })
  type: ModifierType;

  @Column({ name: 'name_ar' })
  nameAr: string;

  @Column({ name: 'name_en', nullable: true })
  nameEn: string;

  /** Addon: price added per unit. Without: price reduction per unit (>= 0). */
  @Column({ type: 'decimal', precision: 18, scale: 4, default: 0 })
  price: number;

  /** Addon: stock product consumed per unit of the line. */
  @Column({ name: 'stock_product_id', type: 'uuid', nullable: true })
  stockProductId: string | null;

  @Column({ name: 'stock_quantity', type: 'decimal', precision: 18, scale: 4, default: 0 })
  stockQuantity: number;

  /** Without: ingredient that is left out (not consumed). */
  @Column({ name: 'ingredient_product_id', type: 'uuid', nullable: true })
  ingredientProductId: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}

export interface ComboGroupItem {
  productId: string;
  /** Added to the combo price when this choice is picked. */
  extraPrice: number;
  /** Units of the component issued per combo unit (default 1). */
  quantity: number;
}

/** A choice group of a combo/meal product ("choose a drink"). */
@Entity('restaurant_combo_groups')
@Index(['tenantId', 'comboProductId'])
export class ComboGroup extends TenantBaseEntity {
  @Column({ name: 'combo_product_id', type: 'uuid' })
  comboProductId: string;

  @Column({ name: 'name_ar' })
  nameAr: string;

  @Column({ name: 'name_en', nullable: true })
  nameEn: string;

  @Column({ name: 'min_picks', type: 'int', default: 1 })
  minPicks: number;

  @Column({ name: 'max_picks', type: 'int', default: 1 })
  maxPicks: number;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  items: ComboGroupItem[];
}
