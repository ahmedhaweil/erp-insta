import { Entity, Column } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

export enum TaxCountry {
  EG = 'EG',
  SA = 'SA',
}

@Entity('tax_configs')
export class TaxConfig extends TenantBaseEntity {
  @Column({ type: 'enum', enum: TaxCountry })
  country: TaxCountry;

  @Column({ name: 'tax_type' })
  taxType: string;

  @Column({ type: 'decimal', precision: 5, scale: 2 })
  rate: number;

  @Column({ name: 'name_ar' })
  nameAr: string;

  @Column({ name: 'name_en' })
  nameEn: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}
