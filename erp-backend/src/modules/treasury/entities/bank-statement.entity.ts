import { Entity, Column, OneToMany, ManyToOne, JoinColumn, Index } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { BaseEntity } from '@shared/entities/base.entity';

export enum BankStatementStatus {
  OPEN = 'open',
  RECONCILED = 'reconciled',
}

/** Imported bank statement of a bank treasury. */
@Entity('bank_statements')
export class BankStatement extends TenantBaseEntity {
  @Column({ name: 'treasury_id', type: 'uuid' })
  treasuryId: string;

  @Column({ nullable: true })
  reference: string;

  @Column({ name: 'start_date', type: 'date' })
  startDate: string;

  @Column({ name: 'end_date', type: 'date' })
  endDate: string;

  @Column({ name: 'opening_balance', type: 'decimal', precision: 18, scale: 4, default: 0 })
  openingBalance: number;

  @Column({ name: 'closing_balance', type: 'decimal', precision: 18, scale: 4, default: 0 })
  closingBalance: number;

  @Column({ type: 'enum', enum: BankStatementStatus, default: BankStatementStatus.OPEN })
  status: BankStatementStatus;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @OneToMany(() => BankStatementLine, (l) => l.statement, { cascade: true })
  lines: BankStatementLine[];
}

@Entity('bank_statement_lines')
export class BankStatementLine extends BaseEntity {
  @Column({ name: 'statement_id', type: 'uuid' })
  @Index()
  statementId: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ nullable: true })
  description: string;

  @Column({ nullable: true })
  reference: string;

  /** Signed, in the treasury currency: positive = deposit, negative = withdrawal. */
  @Column({ type: 'decimal', precision: 18, scale: 4 })
  amount: number;

  @Column({ name: 'is_matched', default: false })
  isMatched: boolean;

  @ManyToOne(() => BankStatement, (s) => s.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'statement_id' })
  statement: BankStatement;
}

/**
 * Match between a statement line and a journal line on the treasury's GL
 * account. Kept here instead of flagging journal_lines; a journal line is
 * reconciled when it has a match row.
 */
@Entity('bank_reconciliation_matches')
@Index(['tenantId', 'journalLineId'], { unique: true })
export class BankReconciliationMatch extends TenantBaseEntity {
  @Column({ name: 'statement_line_id', type: 'uuid' })
  @Index()
  statementLineId: string;

  @Column({ name: 'journal_line_id', type: 'uuid' })
  journalLineId: string;

  @Column({ name: 'treasury_id', type: 'uuid' })
  treasuryId: string;

  /** Signed treasury-currency amount of the journal line. */
  @Column({ type: 'decimal', precision: 18, scale: 4 })
  amount: number;

  /** 'auto' or 'manual'. */
  @Column({ name: 'match_type', default: 'manual' })
  matchType: string;
}
