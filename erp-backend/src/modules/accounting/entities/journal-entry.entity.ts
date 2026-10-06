import { Entity, Column, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { Journal } from './journal.entity';
import { JournalLine } from './journal-line.entity';

export enum JournalEntryStatus {
  DRAFT = 'draft',
  POSTED = 'posted',
  CANCELLED = 'cancelled',
}

@Entity('journal_entries')
export class JournalEntry extends TenantBaseEntity {
  @Column({ name: 'journal_id', type: 'uuid' })
  journalId: string;

  @Column({ name: 'ref_number' })
  refNumber: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ nullable: true })
  description: string;

  @Column({ name: 'currency_id', type: 'uuid', nullable: true })
  currencyId: string;

  @Column({ name: 'exchange_rate', type: 'decimal', precision: 12, scale: 6, default: 1 })
  exchangeRate: number;

  @Column({ type: 'enum', enum: JournalEntryStatus, default: JournalEntryStatus.DRAFT })
  status: JournalEntryStatus;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @Column({ name: 'posted_at', type: 'timestamptz', nullable: true })
  postedAt: Date;

  /** Business document that generated this entry (e.g. sales_invoice, payment). */
  @Column({ name: 'source_type', nullable: true })
  sourceType: string;

  @Column({ name: 'source_id', type: 'uuid', nullable: true })
  sourceId: string;

  /** On a reversal entry: the entry it reverses. */
  @Column({ name: 'reversed_entry_id', type: 'uuid', nullable: true })
  reversedEntryId: string;

  @ManyToOne(() => Journal)
  @JoinColumn({ name: 'journal_id' })
  journal: Journal;

  @OneToMany(() => JournalLine, (line) => line.entry, { cascade: true })
  lines: JournalLine[];
}
