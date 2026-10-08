import { Entity, Column } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

export enum TransferStatus {
  DRAFT = 'draft',
  POSTED = 'posted',
  CANCELLED = 'cancelled',
}

/** Money moved between two treasuries (cash deposit, bank withdrawal, bank to bank). */
@Entity('treasury_transfers')
export class TreasuryTransfer extends TenantBaseEntity {
  @Column({ name: 'transfer_number' })
  transferNumber: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ name: 'from_treasury_id', type: 'uuid' })
  fromTreasuryId: string;

  @Column({ name: 'to_treasury_id', type: 'uuid' })
  toTreasuryId: string;

  /** Amount leaving the source treasury, in its currency (excluding the fee). */
  @Column({ type: 'decimal', precision: 18, scale: 4 })
  amount: number;

  /** Destination-currency units per source-currency unit. */
  @Column({ type: 'decimal', precision: 18, scale: 8, default: 1 })
  rate: number;

  /** Amount arriving in the destination treasury, in its currency. */
  @Column({ name: 'to_amount', type: 'decimal', precision: 18, scale: 4 })
  toAmount: number;

  /** Base-currency units per source-currency unit (valuation of the transfer). */
  @Column({ name: 'base_rate', type: 'decimal', precision: 12, scale: 6, default: 1 })
  baseRate: number;

  /** Bank fee charged on the source treasury, in its currency. */
  @Column({ type: 'decimal', precision: 18, scale: 4, default: 0 })
  fee: number;

  @Column({ type: 'enum', enum: TransferStatus, default: TransferStatus.DRAFT })
  status: TransferStatus;

  @Column({ nullable: true })
  reference: string;

  @Column({ nullable: true })
  description: string;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;
}
