import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '@shared/entities/base.entity';
import { JournalEntry } from './journal-entry.entity';

@Entity('journal_lines')
export class JournalLine extends BaseEntity {
  @Column({ name: 'entry_id', type: 'uuid' })
  entryId: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId: string;

  @Column({ name: 'cost_center_id', type: 'uuid', nullable: true })
  costCenterId: string;

  @Column({ type: 'decimal', precision: 18, scale: 4, default: 0 })
  debit: number;

  @Column({ type: 'decimal', precision: 18, scale: 4, default: 0 })
  credit: number;

  @Column({ nullable: true })
  description: string;

  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string;

  @ManyToOne(() => JournalEntry, (entry) => entry.lines)
  @JoinColumn({ name: 'entry_id' })
  entry: JournalEntry;
}
