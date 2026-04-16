import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

@Entity('units')
export class Unit extends TenantBaseEntity {
  @Column({ name: 'name_ar' })
  nameAr: string;

  @Column({ name: 'name_en', nullable: true })
  nameEn: string;

  @Column()
  symbol: string;

  @Column({ name: 'base_unit_id', type: 'uuid', nullable: true })
  baseUnitId: string;

  @Column({
    name: 'conversion_factor',
    type: 'decimal',
    precision: 18,
    scale: 6,
    default: 1,
  })
  conversionFactor: number;

  @ManyToOne(() => Unit, { nullable: true })
  @JoinColumn({ name: 'base_unit_id' })
  baseUnit: Unit;
}
