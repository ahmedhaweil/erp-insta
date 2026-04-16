import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '@shared/entities/base.entity';
import { Currency } from './currency.entity';

@Entity('exchange_rates')
export class ExchangeRate extends BaseEntity {
  @Column({ name: 'currency_id', type: 'uuid' })
  currencyId: string;

  @Column({ type: 'decimal', precision: 12, scale: 6 })
  rate: number;

  @Column({ type: 'date' })
  date: string;

  @ManyToOne(() => Currency)
  @JoinColumn({ name: 'currency_id' })
  currency: Currency;
}
