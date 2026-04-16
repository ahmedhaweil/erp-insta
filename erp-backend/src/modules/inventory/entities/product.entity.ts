import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { Category } from './category.entity';
import { Unit } from './unit.entity';

export enum ProductType {
  GOODS = 'goods',
  SERVICE = 'service',
}

@Entity('products')
export class Product extends TenantBaseEntity {
  @Column()
  code: string;

  @Column({ name: 'name_ar' })
  nameAr: string;

  @Column({ name: 'name_en', nullable: true })
  nameEn: string;

  @Column({ type: 'enum', enum: ProductType })
  type: ProductType;

  @Column({ nullable: true })
  barcode: string;

  @Column({ nullable: true })
  sku: string;

  @Column({ name: 'category_id', type: 'uuid' })
  categoryId: string;

  @Column({ name: 'unit_id', type: 'uuid' })
  unitId: string;

  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string;

  @Column({ name: 'cost_price', type: 'decimal', precision: 18, scale: 4, default: 0 })
  costPrice: number;

  @Column({ name: 'sell_price', type: 'decimal', precision: 18, scale: 4, default: 0 })
  sellPrice: number;

  @Column({ name: 'reorder_level', type: 'decimal', precision: 18, scale: 4, default: 0 })
  reorderLevel: number;

  @Column({ name: 'reorder_qty', type: 'decimal', precision: 18, scale: 4, default: 0 })
  reorderQty: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ nullable: true })
  description: string;

  @Column({ name: 'image_url', nullable: true })
  imageUrl: string;

  @ManyToOne(() => Category)
  @JoinColumn({ name: 'category_id' })
  category: Category;

  @ManyToOne(() => Unit)
  @JoinColumn({ name: 'unit_id' })
  unit: Unit;
}
