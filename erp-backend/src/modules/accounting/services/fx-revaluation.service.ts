import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  FxRevaluation,
  FxRevaluationItem,
  FxRevaluationStatus,
} from '../entities/closing.entities';
import { JournalType } from '../entities/journal.entity';
import { FxRevaluationDto } from '../dto/accounting-depth.dto';
import { AccountingSettingsService } from './accounting-settings.service';
import { AutoPostingService, PostingLine } from './auto-posting.service';
import { JournalEntriesService } from './journal-entries.service';
import { SequenceService } from '@shared/services/sequence.service';
import { addDays, round } from '@shared/utils/document-totals.util';

export const FX_REVALUATION_SOURCE = 'fx_revaluation';

export interface OpenForeignDocument {
  kind: 'receivable' | 'payable';
  currencyId: string;
  /** Rate the document was booked at. */
  rate: number;
  /** Open amount in document currency; negative for credit notes / vendor refunds. */
  residual: number;
}

export interface ForeignTreasuryBalance {
  treasuryId: string;
  label: string;
  accountId: string;
  currencyId: string;
  /** Balance in the treasury currency. */
  balance: number;
  /** Balance currently booked in base currency on the GL account. */
  baseBalance: number;
}

/** The day after the month end of `date` (first day of the next period). */
export function nextPeriodStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
    .toISOString()
    .split('T')[0];
  return addDays(end, 1);
}

/**
 * Pure computation of an unrealised FX revaluation: open receivables and
 * payables are grouped per currency and revalued at the closing rate;
 * foreign-currency treasuries are revalued on their GL balance.
 */
export function computeRevaluation(
  documents: OpenForeignDocument[],
  treasuries: ForeignTreasuryBalance[],
  rates: Record<string, number>,
  accounts: { receivable?: string | null; payable?: string | null },
): { items: FxRevaluationItem[]; missingRates: string[] } {
  const items: FxRevaluationItem[] = [];
  const missing = new Set<string>();
  const groups = new Map<string, { kind: 'receivable' | 'payable'; currencyId: string; foreign: number; booked: number; count: number }>();

  for (const doc of documents) {
    const key = `${doc.kind}|${doc.currencyId}`;
    const g = groups.get(key) ?? { kind: doc.kind, currencyId: doc.currencyId, foreign: 0, booked: 0, count: 0 };
    g.foreign = round(g.foreign + doc.residual, 4);
    g.booked = round(g.booked + doc.residual * doc.rate, 4);
    g.count += 1;
    groups.set(key, g);
  }

  for (const g of groups.values()) {
    const rate = rates[g.currencyId];
    if (!(rate > 0)) {
      missing.add(g.currencyId);
      continue;
    }
    const bookedBase = round(g.booked, 2);
    const revaluedBase = round(g.foreign * rate, 2);
    const difference = round(revaluedBase - bookedBase, 2);
    items.push({
      kind: g.kind,
      currencyId: g.currencyId,
      accountId: (g.kind === 'receivable' ? accounts.receivable : accounts.payable) ?? null,
      label: `${g.kind === 'receivable' ? 'Receivables' : 'Payables'}`,
      documents: g.count,
      foreignAmount: g.foreign,
      bookedBase,
      rate,
      revaluedBase,
      difference,
      // A larger receivable is a gain; a larger payable is a loss.
      gainLoss: g.kind === 'receivable' ? difference : -difference,
    });
  }

  for (const t of treasuries) {
    const rate = rates[t.currencyId];
    if (!(rate > 0)) {
      missing.add(t.currencyId);
      continue;
    }
    const bookedBase = round(t.baseBalance, 2);
    const revaluedBase = round(t.balance * rate, 2);
    const difference = round(revaluedBase - bookedBase, 2);
    items.push({
      kind: 'treasury',
      currencyId: t.currencyId,
      accountId: t.accountId,
      treasuryId: t.treasuryId,
      label: t.label,
      foreignAmount: round(t.balance, 4),
      bookedBase,
      rate,
      revaluedBase,
      difference,
      gainLoss: difference,
    });
  }
  return { items, missingRates: [...missing] };
}

/** Journal lines for revaluation items (amount in currency 0: only the base value moves). */
export function revaluationLines(
  items: FxRevaluationItem[],
  fxGainAccountId: string,
  fxLossAccountId: string,
): PostingLine[] {
  const lines: PostingLine[] = [];
  for (const item of items) {
    if (!item.difference || !item.accountId) continue;
    const amount = Math.abs(item.difference);
    const increase = item.difference > 0;
    const description = `FX revaluation ${item.currencyCode ?? ''} ${item.label} @ ${item.rate}`.replace(/\s+/g, ' ');
    // The asset/liability account moves by the difference...
    lines.push({
      accountId: item.accountId,
      [item.kind === 'payable' ? (increase ? 'credit' : 'debit') : increase ? 'debit' : 'credit']: amount,
      amountCurrency: 0,
      description,
    });
    // ...against an exchange gain or loss.
    lines.push({
      accountId: item.gainLoss > 0 ? fxGainAccountId : fxLossAccountId,
      [item.gainLoss > 0 ? 'credit' : 'debit']: amount,
      amountCurrency: 0,
      description,
    });
  }
  return lines;
}

/**
 * Unrealised exchange gains/losses at a period end, auto-reversed on the
 * first day of the next period (Odoo-style), so realised differences keep
 * being computed from the original document rates.
 */
@Injectable()
export class FxRevaluationService {
  constructor(
    @InjectRepository(FxRevaluation)
    private readonly revaluationRepo: Repository<FxRevaluation>,
    private readonly settingsService: AccountingSettingsService,
    private readonly autoPosting: AutoPostingService,
    private readonly journalEntries: JournalEntriesService,
    private readonly sequenceService: SequenceService,
  ) {}

  findAll(tenantId: string): Promise<FxRevaluation[]> {
    return this.revaluationRepo.find({ where: { tenantId }, order: { date: 'DESC' } });
  }

  async findById(tenantId: string, id: string): Promise<FxRevaluation> {
    const revaluation = await this.revaluationRepo.findOne({ where: { id, tenantId } });
    if (!revaluation) throw new NotFoundException('FX revaluation not found');
    return revaluation;
  }

  /** Computation shown before posting (no side effects). */
  async preview(tenantId: string, dto: FxRevaluationDto) {
    const settings = await this.settingsService.get(tenantId);
    const rates = await this.resolveRates(tenantId, dto);
    const [documents, treasuries, codes] = await Promise.all([
      this.openDocuments(tenantId, dto.date),
      this.treasuryBalances(tenantId, dto.date),
      this.currencyCodes(),
    ]);
    const { items, missingRates } = computeRevaluation(documents, treasuries, rates, {
      receivable: settings.receivableAccountId,
      payable: settings.payableAccountId,
    });
    items.forEach((i) => (i.currencyCode = codes.get(i.currencyId)));
    const totalGain = round(items.filter((i) => i.gainLoss > 0).reduce((s, i) => s + i.gainLoss, 0), 2);
    const totalLoss = round(items.filter((i) => i.gainLoss < 0).reduce((s, i) => s - i.gainLoss, 0), 2);
    return {
      date: dto.date,
      reversalDate: dto.reversalDate ?? nextPeriodStart(dto.date),
      rates,
      items,
      totalGain,
      totalLoss,
      net: round(totalGain - totalLoss, 2),
      warnings: [
        ...missingRates.map(
          (c) => `No rate for currency ${codes.get(c) ?? c} on ${dto.date}; its balances are not revalued`,
        ),
        ...(!settings.fxGainAccountId || !settings.fxLossAccountId
          ? ['Accounting settings need fxGainAccountId and fxLossAccountId to post']
          : []),
      ],
    };
  }

  /** Posts the revaluation and its reversal on the first day of the next period. */
  async post(tenantId: string, userId: string, dto: FxRevaluationDto) {
    const pending = await this.revaluationRepo.findOne({
      where: { tenantId, status: FxRevaluationStatus.POSTED },
    });
    if (pending) {
      throw new ConflictException(
        `Revaluation ${pending.revaluationNumber} of ${pending.date} is not reversed yet; reverse it first`,
      );
    }
    const later = await this.revaluationRepo
      .createQueryBuilder('r')
      .where('r.tenant_id = :tenantId AND r.reversal_date > :date', { tenantId, date: dto.date })
      .getOne();
    if (later) {
      throw new ConflictException(
        `Revaluation ${later.revaluationNumber} (reversed on ${later.reversalDate}) already covers ${dto.date}`,
      );
    }
    const reversalDate = dto.reversalDate ?? nextPeriodStart(dto.date);
    if (reversalDate <= dto.date) throw new BadRequestException('The reversal date must follow the revaluation date');

    const preview = await this.preview(tenantId, dto);
    const settings = await this.settingsService.get(tenantId);
    if (!settings.fxGainAccountId || !settings.fxLossAccountId) {
      throw new BadRequestException('Accounting settings are missing fxGainAccountId / fxLossAccountId');
    }
    const lines = revaluationLines(preview.items, settings.fxGainAccountId, settings.fxLossAccountId);
    if (!lines.length) throw new ConflictException('Nothing to revalue on this date');
    await this.journalEntries.assertPeriodOpen(tenantId, dto.date);

    const revaluation = await this.revaluationRepo.save(
      this.revaluationRepo.create({
        tenantId,
        revaluationNumber: await this.sequenceService.next(tenantId, 'fx_revaluation', 'FXR'),
        date: dto.date,
        reversalDate,
        status: FxRevaluationStatus.POSTED,
        rates: preview.rates,
        items: preview.items,
        totalGain: preview.totalGain,
        totalLoss: preview.totalLoss,
        createdBy: userId,
      }),
    );
    const entry = await this.autoPosting.post({
      tenantId,
      userId,
      journalType: JournalType.GENERAL,
      date: dto.date,
      description: `Unrealised FX revaluation ${revaluation.revaluationNumber} at ${dto.date}`,
      sourceType: FX_REVALUATION_SOURCE,
      sourceId: revaluation.id,
      buildLines: () => lines,
    });
    revaluation.entryId = entry?.id ?? null;
    await this.revaluationRepo.save(revaluation);

    const warnings = [...preview.warnings];
    try {
      await this.reverse(tenantId, userId, revaluation.id, reversalDate);
    } catch (err) {
      // Reversal validation (e.g. the next fiscal year is not open) fails before writing.
      if (!(err instanceof HttpException)) throw err;
      warnings.push(
        `Automatic reversal on ${reversalDate} failed (${err.message}); reverse it later with POST /accounting/fx-revaluations/${revaluation.id}/reverse`,
      );
    }
    return { revaluation: await this.findById(tenantId, revaluation.id), warnings };
  }

  async reverse(tenantId: string, userId: string, id: string, date?: string) {
    const revaluation = await this.findById(tenantId, id);
    if (revaluation.status !== FxRevaluationStatus.POSTED) {
      throw new ConflictException(`Revaluation ${revaluation.revaluationNumber} is already reversed`);
    }
    if (revaluation.entryId) {
      const reversal = await this.journalEntries.reverse(
        tenantId,
        userId,
        revaluation.entryId,
        date ?? revaluation.reversalDate,
      );
      revaluation.reversalEntryId = reversal.id;
    }
    if (date) revaluation.reversalDate = date;
    revaluation.status = FxRevaluationStatus.REVERSED;
    return this.revaluationRepo.save(revaluation);
  }

  // ------------------------------------------------------------ queries

  private async resolveRates(tenantId: string, dto: FxRevaluationDto): Promise<Record<string, number>> {
    const rates: Record<string, number> = {};
    const rows: { currency_id: string; rate: string }[] = await this.revaluationRepo.query(
      `SELECT DISTINCT ON (currency_id) currency_id, rate
         FROM exchange_rates WHERE date <= $1
        ORDER BY currency_id, date DESC, created_at DESC`,
      [dto.date],
    );
    rows.forEach((r) => (rates[r.currency_id] = Number(r.rate)));
    (dto.rates ?? []).forEach((r) => (rates[r.currencyId] = Number(r.rate)));
    void tenantId;
    return rates;
  }

  private async currencyCodes(): Promise<Map<string, string>> {
    const rows: { id: string; code: string }[] = await this.revaluationRepo.query(
      `SELECT id, code FROM currencies`,
    );
    return new Map(rows.map((r) => [r.id, r.code]));
  }

  /** Open foreign-currency invoices / bills (read-only on the sales and purchasing tables). */
  async openDocuments(tenantId: string, date: string): Promise<OpenForeignDocument[]> {
    const rows: { kind: 'receivable' | 'payable'; currency_id: string; rate: string; residual: string }[] =
      await this.revaluationRepo.query(
        `SELECT 'receivable' AS kind, i.currency_id, i.exchange_rate AS rate,
                (CASE WHEN i.move_type = 'credit_note' THEN -1 ELSE 1 END) * (i.total_amount - i.paid_amount) AS residual
           FROM sales_invoices i
           LEFT JOIN currencies c ON c.id = i.currency_id
          WHERE i.tenant_id = $1 AND i.date <= $2 AND i.currency_id IS NOT NULL
            AND COALESCE(c.is_base, false) = false AND i.exchange_rate <> 1
            AND i.status IN ('posted', 'sent', 'partial', 'overdue')
            AND i.total_amount - i.paid_amount > 0
         UNION ALL
         SELECT 'payable' AS kind, b.currency_id, b.exchange_rate AS rate,
                (CASE WHEN b.move_type = 'refund' THEN -1 ELSE 1 END) * (b.total_amount - b.paid_amount) AS residual
           FROM purchase_invoices b
           LEFT JOIN currencies c ON c.id = b.currency_id
          WHERE b.tenant_id = $1 AND b.date <= $2 AND b.currency_id IS NOT NULL
            AND COALESCE(c.is_base, false) = false AND b.exchange_rate <> 1
            AND b.status IN ('approved', 'partial', 'overdue')
            AND b.total_amount - b.paid_amount > 0`,
        [tenantId, date],
      );
    return rows.map((r) => ({
      kind: r.kind,
      currencyId: r.currency_id,
      rate: Number(r.rate),
      residual: Number(r.residual),
    }));
  }

  /**
   * Balances of active foreign-currency treasuries as of `date`: currency
   * amount from amount_currency (fallback base / entry rate, as the treasury
   * ledger does) and base amount from debit - credit.
   */
  async treasuryBalances(tenantId: string, date: string): Promise<ForeignTreasuryBalance[]> {
    const rows: any[] = await this.revaluationRepo.query(
      `SELECT t.id, t.code, COALESCE(t.name_en, t.name_ar) AS name, t.account_id, t.currency_id,
              COALESCE(SUM(COALESCE(x.amount_currency, (x.debit - x.credit) / NULLIF(x.exchange_rate, 0))), 0) AS balance,
              COALESCE(SUM(x.debit - x.credit), 0) AS base_balance
         FROM treasuries t
         LEFT JOIN currencies c ON c.id = t.currency_id
         LEFT JOIN (
               SELECT jl.account_id, jl.amount_currency, jl.debit, jl.credit, je.exchange_rate
                 FROM journal_lines jl
                 JOIN journal_entries je ON je.id = jl.entry_id
                WHERE je.tenant_id = $1 AND je.status = 'posted' AND je.date <= $2
              ) x ON x.account_id = t.account_id
        WHERE t.tenant_id = $1 AND t.is_active = true AND t.currency_id IS NOT NULL
          AND COALESCE(c.is_base, false) = false
        GROUP BY t.id`,
      [tenantId, date],
    );
    return rows.map((r) => ({
      treasuryId: r.id,
      label: `${r.code} ${r.name ?? ''}`.trim(),
      accountId: r.account_id,
      currencyId: r.currency_id,
      balance: Number(r.balance),
      baseBalance: Number(r.base_balance),
    }));
  }
}
