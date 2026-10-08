import { Column, Entity } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

export enum FxRevaluationStatus {
  /** Posted; the reversal is still to come. */
  POSTED = 'posted',
  /** Posted and auto-reversed. */
  REVERSED = 'reversed',
}

/** One computed item of a revaluation (an open document currency group or a treasury). */
export interface FxRevaluationItem {
  kind: 'receivable' | 'payable' | 'treasury';
  currencyId: string;
  currencyCode?: string;
  /** GL account adjusted (receivable/payable control account or treasury account). */
  accountId: string | null;
  treasuryId?: string;
  label: string;
  documents?: number;
  /** Open amount in the foreign currency (signed: credit notes/refunds negative). */
  foreignAmount: number;
  /** Amount currently booked in base currency. */
  bookedBase: number;
  rate: number;
  revaluedBase: number;
  /** revaluedBase - bookedBase on the asset/liability (positive = account increases). */
  difference: number;
  /** Effect on profit: positive gain, negative loss. */
  gainLoss: number;
}

/**
 * Unrealised exchange difference posting at a period end (Odoo "exchange
 * difference" / currency revaluation), auto-reversed on the first day of the
 * next period.
 */
@Entity('fx_revaluations')
export class FxRevaluation extends TenantBaseEntity {
  @Column({ name: 'revaluation_number' })
  revaluationNumber: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ name: 'reversal_date', type: 'date' })
  reversalDate: string;

  @Column({ type: 'enum', enum: FxRevaluationStatus, default: FxRevaluationStatus.POSTED })
  status: FxRevaluationStatus;

  /** currencyId -> rate used. */
  @Column({ type: 'jsonb' })
  rates: Record<string, number>;

  @Column({ type: 'jsonb' })
  items: FxRevaluationItem[];

  @Column({ name: 'total_gain', type: 'decimal', precision: 18, scale: 4, default: 0 })
  totalGain: number;

  @Column({ name: 'total_loss', type: 'decimal', precision: 18, scale: 4, default: 0 })
  totalLoss: number;

  @Column({ name: 'entry_id', type: 'uuid', nullable: true })
  entryId: string | null;

  @Column({ name: 'reversal_entry_id', type: 'uuid', nullable: true })
  reversalEntryId: string | null;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;
}

export enum OpeningBalanceKind {
  ACCOUNTS = 'accounts',
  CUSTOMER = 'customer',
  SUPPLIER = 'supplier',
}

/**
 * Opening balances recorded when a company starts on the system: one GL
 * opening entry for account balances, and opening receivable / payable
 * documents (posted invoices / bills) per partner.
 */
@Entity('opening_balances')
export class OpeningBalance extends TenantBaseEntity {
  @Column({ type: 'enum', enum: OpeningBalanceKind })
  kind: OpeningBalanceKind;

  @Column({ type: 'date' })
  date: string;

  @Column({ name: 'partner_id', type: 'uuid', nullable: true })
  partnerId: string | null;

  /** sales_invoices / purchase_invoices id for partner openings. */
  @Column({ name: 'document_id', type: 'uuid', nullable: true })
  documentId: string | null;

  @Column({ name: 'document_number', type: 'varchar', nullable: true })
  documentNumber: string | null;

  /** Signed amount in document currency (partner) or total debit (accounts). */
  @Column({ type: 'decimal', precision: 18, scale: 4 })
  amount: number;

  @Column({ name: 'currency_id', type: 'uuid', nullable: true })
  currencyId: string | null;

  @Column({ name: 'exchange_rate', type: 'decimal', precision: 12, scale: 6, default: 1 })
  exchangeRate: number;

  @Column({ name: 'equity_account_id', type: 'uuid' })
  equityAccountId: string;

  @Column({ name: 'entry_id', type: 'uuid', nullable: true })
  entryId: string | null;

  @Column({ nullable: true })
  description: string;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;
}

/** Log of period locks and re-openings. */
@Entity('period_closings')
export class PeriodClosing extends TenantBaseEntity {
  @Column({ type: 'varchar' })
  action: 'lock' | 'reopen';

  @Column({ name: 'lock_date', type: 'date', nullable: true })
  lockDate: string | null;

  @Column({ name: 'previous_lock_date', type: 'date', nullable: true })
  previousLockDate: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  warnings: { code: string; count: number; message: string }[];

  @Column({ nullable: true })
  notes: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;
}
