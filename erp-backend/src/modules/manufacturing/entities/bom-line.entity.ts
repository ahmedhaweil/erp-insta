import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { Product } from '@modules/inventory/entities/product.entity';
import { Bom } from './bom.entity';

export enum BomLineType {
  COMPONENT = 'component',
  BY_PRODUCT = 'by_product',
}

@Entity('mfg_bom_lines')
export class BomLine extends TenantBaseEntity {
  @Column({ name: 'bom_id', type: 'uuid' })
  bomId: string;

  @Column({ type: 'enum', enum: BomLineType, default: BomLineType.COMPONENT })
  type: BomLineType;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  /** Quantity per `bom.outputQuantity` finished units. */
  @Column({ type: 'decimal', precision: 18, scale: 4 })
  quantity: number;

  /** Expected scrap / loss (%) added on top of the component quantity. */
  @Column({ name: 'scrap_percent', type: 'decimal', precision: 7, scale: 4, default: 0 })
  scrapPercent: number;

  /** By-products only: share (%) of the production cost assigned to the by-product. */
  @Column({ name: 'cost_share_percent', type: 'decimal', precision: 7, scale: 4, default: 0 })
  costSharePercent: number;

  @Column({ type: 'int', default: 0 })
  sequence: number;

  @ManyToOne(() => Bom, (b) => b.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bom_id' })
  bom: Bom;

  @ManyToOne(() => Product)
  @JoinColumn({ name: 'product_id' })
  product: Product;
}
