import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JournalLine } from '@modules/accounting/entities/journal-line.entity';
import { Treasury } from '../entities/treasury.entity';
import { round } from '@shared/utils/document-totals.util';

export interface LedgerLine {
  journalLineId: string;
  entryId: string;
  refNumber: string;
  date: string;
  description: string;
  sourceType: string | null;
  sourceId: string | null;
  /** Base currency. */
  debit: number;
  credit: number;
  /** Signed amount in the treasury currency (positive = money in). */
  amount: number;
  /** Statement line it is reconciled with, if any. */
  statementLineId: string | null;
}

export interface LedgerFilter {
  from?: string;
  to?: string;
  /** Only lines that are not matched with a bank statement line. */
  unreconciled?: boolean;
  journalLineIds?: string[];
}

/**
 * Reads the posted journal lines on a treasury's GL account: the source of
 * the treasury balance, the cash book and bank reconciliation.
 *
 * For a foreign-currency treasury the amount is the line's amount in
 * currency, falling back to base / entry rate for lines that lost it (e.g.
 * generic reversals).
 */
@Injectable()
export class TreasuryLedgerService {
  constructor(
    @InjectRepository(JournalLine)
    private readonly lineRepo: Repository<JournalLine>,
  ) {}

  private amountSql(treasury: Treasury): string {
    return treasury.currencyId
      ? `COALESCE(jl.amount_currency, (jl.debit - jl.credit) / NULLIF(je.exchange_rate, 0))`
      : `(jl.debit - jl.credit)`;
  }

  async lines(tenantId: string, treasury: Treasury, filter: LedgerFilter = {}): Promise<LedgerLine[]> {
    const params: any[] = [tenantId, treasury.accountId];
    const where = [`je.tenant_id = $1`, `jl.account_id = $2`, `je.status = 'posted'`];
    if (filter.from) {
      params.push(filter.from);
      where.push(`je.date >= $${params.length}`);
    }
    if (filter.to) {
      params.push(filter.to);
      where.push(`je.date <= $${params.length}`);
    }
    if (filter.unreconciled) where.push(`m.id IS NULL`);
    if (filter.journalLineIds) {
      if (!filter.journalLineIds.length) return [];
      params.push(filter.journalLineIds);
      where.push(`jl.id = ANY($${params.length}::uuid[])`);
    }
    const rows: any[] = await this.lineRepo.query(
      `SELECT jl.id AS journal_line_id, je.id AS entry_id, je.ref_number, je.date::text AS date,
              COALESCE(jl.description, je.description) AS description,
              je.source_type, je.source_id, jl.debit, jl.credit,
              ${this.amountSql(treasury)} AS amount, m.statement_line_id
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.entry_id
         LEFT JOIN bank_reconciliation_matches m
           ON m.journal_line_id = jl.id AND m.tenant_id = je.tenant_id
        WHERE ${where.join(' AND ')}
        ORDER BY je.date ASC, je.created_at ASC, jl.debit DESC`,
      params,
    );
    return rows.map((r) => ({
      journalLineId: r.journal_line_id,
      entryId: r.entry_id,
      refNumber: r.ref_number,
      date: String(r.date).slice(0, 10),
      description: r.description,
      sourceType: r.source_type,
      sourceId: r.source_id,
      debit: Number(r.debit),
      credit: Number(r.credit),
      amount: round(Number(r.amount), 4),
      statementLineId: r.statement_line_id ?? null,
    }));
  }

  /** Balance in the treasury currency and in base currency, up to `asOf` (inclusive) or before `before`. */
  async balance(
    tenantId: string,
    treasury: Treasury,
    opts: { asOf?: string; before?: string } = {},
  ): Promise<{ balance: number; baseBalance: number }> {
    const params: any[] = [tenantId, treasury.accountId];
    const where = [`je.tenant_id = $1`, `jl.account_id = $2`, `je.status = 'posted'`];
    if (opts.asOf) {
      params.push(opts.asOf);
      where.push(`je.date <= $${params.length}`);
    }
    if (opts.before) {
      params.push(opts.before);
      where.push(`je.date < $${params.length}`);
    }
    const [row] = await this.lineRepo.query(
      `SELECT COALESCE(SUM(${this.amountSql(treasury)}), 0) AS balance,
              COALESCE(SUM(jl.debit - jl.credit), 0) AS base_balance
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.entry_id
        WHERE ${where.join(' AND ')}`,
      params,
    );
    return {
      balance: round(Number(row?.balance ?? 0), 4),
      baseBalance: round(Number(row?.base_balance ?? 0), 4),
    };
  }

  /** Refuses to undo a document whose treasury lines are already bank-reconciled. */
  async assertNotReconciled(tenantId: string, sourceType: string, sourceId: string): Promise<void> {
    const [row] = await this.lineRepo.query(
      `SELECT COUNT(*)::int AS n
         FROM bank_reconciliation_matches m
         JOIN journal_lines jl ON jl.id = m.journal_line_id
         JOIN journal_entries je ON je.id = jl.entry_id
        WHERE m.tenant_id = $1 AND je.source_type = $2 AND je.source_id = $3`,
      [tenantId, sourceType, sourceId],
    );
    if (Number(row?.n ?? 0) > 0) {
      throw new ConflictException(
        'The document is matched with a bank statement line; unmatch it first',
      );
    }
  }
}
