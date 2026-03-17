import { Entity, Column } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

export enum JournalType {
  SALE = 'sale',
  PURCHASE = 'purchase',
  BANK = 'bank',
  CASH = 'cash',
  GENERAL = 'general',
}

@Entity('journals')
export class Journal extends TenantBaseEntity {
  @Column()
  name: string;

  @Column({ type: 'enum', enum: JournalType })
  type: JournalType;

  @Column({ name: 'default_account_id', type: 'uuid', nullable: true })
  defaultAccountId: string;
}
