import { Entity, Column } from 'typeorm';
import { BaseEntity } from '@shared/entities/base.entity';

@Entity('currencies')
export class Currency extends BaseEntity {
  @Column({ unique: true })
  code: string;

  @Column({ name: 'name_ar' })
  nameAr: string;

  @Column({ name: 'name_en', nullable: true })
  nameEn: string;

  @Column()
  symbol: string;

  @Column({ name: 'is_base', default: false })
  isBase: boolean;
}
