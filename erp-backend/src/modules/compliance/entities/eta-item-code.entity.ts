import { Entity, Column, Index } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

export enum EtaItemType {
  EGS = 'EGS',
  GS1 = 'GS1',
}

/**
 * ETA item coding of a product (kept in the compliance module so the
 * inventory module does not need to know about tax-authority codes).
 */
@Entity('compliance_item_codes')
@Index(['tenantId', 'productId'], { unique: true })
export class EtaItemCode extends TenantBaseEntity {
  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ name: 'item_type', type: 'enum', enum: EtaItemType, default: EtaItemType.EGS })
  itemType: EtaItemType;

  /** e.g. "EG-113317713-1001" for EGS or the GS1 brick/GTIN code. */
  @Column({ name: 'item_code' })
  itemCode: string;

  /** ETA unit type code; falls back to the unit mapping / default unit type. */
  @Column({ name: 'unit_type', nullable: true })
  unitType: string;

  /** VAT subtype (V001..V010); falls back to the tenant default. */
  @Column({ name: 'tax_subtype', nullable: true })
  taxSubtype: string;

  @Column({ nullable: true })
  description: string;
}
