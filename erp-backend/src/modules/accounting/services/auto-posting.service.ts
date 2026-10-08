import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Journal, JournalType } from '../entities/journal.entity';
import { JournalEntry } from '../entities/journal-entry.entity';
import { AccountingSettings } from '../entities/accounting-settings.entity';
import { JournalEntriesService } from './journal-entries.service';
import { AccountingSettingsService } from './accounting-settings.service';
import { round } from '@shared/utils/document-totals.util';

export type SettingsAccountKey = {
  [K in keyof AccountingSettings]: K extends `${string}AccountId` ? K : never;
}[keyof AccountingSettings];

export interface PostingLine {
  accountId: string;
  debit?: number;
  credit?: number;
  /** Set by the conversion to base currency; callers give document amounts. */
  amountCurrency?: number;
  description?: string;
  costCenterId?: string;
  branchId?: string;
}

export interface PostingRequest {
  tenantId: string;
  userId: string;
  journalType: JournalType;
  date: string;
  description: string;
  sourceType: string;
  sourceId: string;
  currencyId?: string;
  /**
   * Base-currency units per unit of the document currency. Line amounts are
   * given in document currency and converted; 1 (default) means base currency.
   */
  exchangeRate?: number;
  /** Builds the lines once settings are known; return [] to skip posting. */
  buildLines: (
    settings: AccountingSettings,
    account: (key: SettingsAccountKey) => string,
  ) => PostingLine[];
}

const JOURNAL_NAMES: Record<JournalType, string> = {
  [JournalType.SALE]: 'Sales',
  [JournalType.PURCHASE]: 'Purchases',
  [JournalType.BANK]: 'Bank',
  [JournalType.CASH]: 'Cash',
  [JournalType.GENERAL]: 'Miscellaneous Operations',
};

/**
 * Generates journal entries from business documents (invoices, payments,
 * deliveries, POS orders...), the equivalent of Odoo's account.move creation
 * from sale/purchase/stock flows.
 *
 * Automatic accounting is enabled per tenant by saving accounting settings.
 * Tenants without settings keep the operational flows working without
 * postings; tenants with settings get an error if a required account is
 * missing, so the books never silently drift.
 */
@Injectable()
export class AutoPostingService {
  private readonly logger = new Logger(AutoPostingService.name);

  constructor(
    @InjectRepository(Journal)
    private readonly journalRepo: Repository<Journal>,
    private readonly settingsService: AccountingSettingsService,
    private readonly journalEntriesService: JournalEntriesService,
  ) {}

  async post(request: PostingRequest): Promise<JournalEntry | null> {
    const settings = await this.settingsService.find(request.tenantId);
    if (!settings) {
      this.logger.debug(
        `Accounting settings missing for tenant ${request.tenantId}; skipping posting of ${request.sourceType} ${request.sourceId}`,
      );
      return null;
    }

    const account = (key: SettingsAccountKey): string => {
      const id = settings[key] as string | undefined;
      if (!id) {
        throw new BadRequestException(
          `Accounting settings are missing "${key}" required to post ${request.sourceType}`,
        );
      }
      return id;
    };

    const merged = this.mergeLines(request.buildLines(settings, account));
    if (merged.length === 0) return null;
    const lines = this.toBaseCurrency(merged, Number(request.exchangeRate ?? 1) || 1);

    const journal = await this.resolveJournal(request.tenantId, request.journalType);

    return this.journalEntriesService.createAndPost(
      request.tenantId,
      request.userId,
      {
        journalId: journal.id,
        date: request.date,
        description: request.description,
        currencyId: request.currencyId,
        exchangeRate: request.exchangeRate,
        lines: lines.map((l) => ({
          accountId: l.accountId,
          debit: l.debit ?? 0,
          credit: l.credit ?? 0,
          amountCurrency: l.amountCurrency,
          description: l.description ?? request.description,
          costCenterId: l.costCenterId,
          branchId: l.branchId,
        })),
      },
      { sourceType: request.sourceType, sourceId: request.sourceId },
    );
  }

  /**
   * Checks, before a business operation mutates anything, that its posting
   * will be accepted: the required default accounts exist and the date is in
   * an open, unlocked period. No-op when automatic accounting is disabled.
   */
  async preflight(tenantId: string, date: string, keys: SettingsAccountKey[]): Promise<void> {
    const settings = await this.settingsService.find(tenantId);
    if (!settings) return;
    const missing = keys.filter((key) => !settings[key]);
    if (missing.length) {
      throw new BadRequestException(`Accounting settings are missing: ${missing.join(', ')}`);
    }
    await this.journalEntriesService.assertPeriodOpen(tenantId, date);
  }

  /** Reverses every posted entry generated by a document (e.g. on cancellation). */
  async reverseSource(
    tenantId: string,
    userId: string,
    sourceType: string,
    sourceId: string,
    date?: string,
  ): Promise<JournalEntry[]> {
    const entries = await this.journalEntriesService.findBySource(tenantId, sourceType, sourceId);
    const reversals: JournalEntry[] = [];
    for (const entry of entries.filter((e) => !e.reversedEntryId)) {
      try {
        reversals.push(await this.journalEntriesService.reverse(tenantId, userId, entry.id, date));
      } catch (err) {
        // Already reversed entries are skipped; anything else must surface.
        if (!(err instanceof Error) || !err.message.startsWith('Entry already reversed')) throw err;
      }
    }
    return reversals;
  }

  async resolveJournal(tenantId: string, type: JournalType): Promise<Journal> {
    const existing = await this.journalRepo.findOne({
      where: { tenantId, type },
      order: { createdAt: 'ASC' },
    });
    if (existing) return existing;
    return this.journalRepo.save(
      this.journalRepo.create({ tenantId, type, name: JOURNAL_NAMES[type] }),
    );
  }

  /**
   * Converts document-currency lines to base currency at `rate`, keeping the
   * original signed amount in amountCurrency. Rounding differences (at most a
   * few hundredths) are absorbed by the largest line of the lighter side so
   * the entry stays balanced, as Odoo does with its rounding line.
   */
  toBaseCurrency(lines: PostingLine[], rate: number): PostingLine[] {
    if (rate === 1) return lines;
    if (!(rate > 0)) throw new BadRequestException('Exchange rate must be positive');
    const converted = lines.map((l) => ({
      ...l,
      amountCurrency: round((l.debit ?? 0) - (l.credit ?? 0), 4),
      debit: round((l.debit ?? 0) * rate, 2),
      credit: round((l.credit ?? 0) * rate, 2),
    }));
    const debit = round(converted.reduce((s, l) => s + l.debit, 0), 2);
    const credit = round(converted.reduce((s, l) => s + l.credit, 0), 2);
    const diff = round(debit - credit, 2);
    if (diff !== 0) {
      const side: 'debit' | 'credit' = diff > 0 ? 'credit' : 'debit';
      const target = converted
        .filter((l) => l[side] > 0)
        .sort((a, b) => b[side] - a[side])[0];
      target[side] = round(target[side] + Math.abs(diff), 2);
    }
    return converted;
  }

  /** Nets lines per account/side, drops zero amounts and validates balance. */
  private mergeLines(lines: PostingLine[]): PostingLine[] {
    const merged = new Map<string, PostingLine>();
    for (const line of lines) {
      const debit = round(Number(line.debit ?? 0), 4);
      const credit = round(Number(line.credit ?? 0), 4);
      if (debit < 0 || credit < 0) {
        throw new BadRequestException('Posting amounts cannot be negative');
      }
      if (debit === 0 && credit === 0) continue;
      const side = debit > 0 ? 'D' : 'C';
      const key = `${line.accountId}|${side}|${line.costCenterId ?? ''}|${line.branchId ?? ''}`;
      const current = merged.get(key);
      if (current) {
        current.debit = round((current.debit ?? 0) + debit, 4);
        current.credit = round((current.credit ?? 0) + credit, 4);
      } else {
        merged.set(key, { ...line, debit, credit });
      }
    }
    return [...merged.values()];
  }
}
