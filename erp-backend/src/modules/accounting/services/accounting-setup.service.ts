import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { Account } from '../entities/account.entity';
import { AccountingSettings } from '../entities/accounting-settings.entity';
import { FiscalYear } from '../entities/fiscal-year.entity';
import { Journal, JournalType } from '../entities/journal.entity';
import { Currency } from '../entities/currency.entity';
import { Tenant } from '@modules/tenants/entities/tenant.entity';
import {
  CHART_TEMPLATES,
  COMMON_CURRENCIES,
  ChartTemplateCode,
  expandTemplate,
} from '../setup/chart-templates';
import type { SettingsAccountKey } from './auto-posting.service';

export interface AccountingSetupInput {
  template: ChartTemplateCode;
  fiscalYearStart: string;
  baseCurrency?: string;
}

export interface AccountingSetupResult {
  template: ChartTemplateCode;
  accountsCreated: number;
  postableAccounts: number;
  settingsKeysFilled: SettingsAccountKey[];
  fiscalYear: FiscalYear;
  journals: Journal[];
  baseCurrency: string;
  currencies: string[];
}

const JOURNALS: { type: JournalType; name: string; defaultKey?: SettingsAccountKey }[] = [
  { type: JournalType.SALE, name: 'Sales', defaultKey: 'salesAccountId' },
  { type: JournalType.PURCHASE, name: 'Purchases', defaultKey: 'purchaseAccountId' },
  { type: JournalType.CASH, name: 'Cash', defaultKey: 'cashAccountId' },
  { type: JournalType.BANK, name: 'Bank', defaultKey: 'bankAccountId' },
  { type: JournalType.GENERAL, name: 'Miscellaneous Operations' },
];

/** Last day of the 12-month period starting at `start` (YYYY-MM-DD). */
export function fiscalYearEnd(start: string): string {
  const [y, m, d] = start.split('-').map(Number);
  const end = new Date(Date.UTC(y + 1, m - 1, d) - 86_400_000);
  return end.toISOString().slice(0, 10);
}

export function fiscalYearName(start: string, end: string): string {
  const y1 = start.slice(0, 4);
  const y2 = end.slice(0, 4);
  return y1 === y2 ? `FY ${y1}` : `FY ${y1}/${y2}`;
}

/**
 * One-shot accounting setup wizard for a new tenant: creates a complete
 * bilingual chart of accounts from a country template, fills every default
 * account of the accounting settings (which turns automatic posting on), opens
 * the first fiscal year, creates the default journals and makes sure the base
 * and common currencies exist.
 *
 * Constructed from plain repositories so the seed script can run it outside
 * the Nest container.
 */
@Injectable()
export class AccountingSetupService {
  constructor(
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    @InjectRepository(AccountingSettings)
    private readonly settingsRepo: Repository<AccountingSettings>,
    @InjectRepository(FiscalYear)
    private readonly fiscalYearRepo: Repository<FiscalYear>,
    @InjectRepository(Journal)
    private readonly journalRepo: Repository<Journal>,
    @InjectRepository(Currency)
    private readonly currencyRepo: Repository<Currency>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
  ) {}

  listTemplates() {
    return Object.values(CHART_TEMPLATES).map((t) => {
      const accounts = expandTemplate(t);
      return {
        code: t.code,
        nameAr: t.nameAr,
        nameEn: t.nameEn,
        country: t.country,
        baseCurrency: t.baseCurrency,
        accounts: accounts.length,
        postableAccounts: accounts.filter((a) => a.allowPosting).length,
      };
    });
  }

  /** Preview of a template's accounts without creating anything. */
  previewTemplate(code: ChartTemplateCode) {
    const template = CHART_TEMPLATES[code];
    if (!template) throw new NotFoundException(`Unknown chart template "${code}"`);
    return expandTemplate(template);
  }

  async setup(tenantId: string, input: AccountingSetupInput): Promise<AccountingSetupResult> {
    const template = CHART_TEMPLATES[input.template];
    if (!template) throw new BadRequestException(`Unknown chart template "${input.template}"`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.fiscalYearStart ?? '')) {
      throw new BadRequestException('fiscalYearStart must be a date (YYYY-MM-DD)');
    }

    const existing = await this.accountRepo.count({ where: { tenantId } });
    if (existing > 0) {
      throw new ConflictException(
        `The tenant already has ${existing} accounts; the setup wizard only runs on an empty chart of accounts`,
      );
    }

    // 1. Chart of accounts, parents before children (one insert per level)
    const rows = expandTemplate(template);
    const idByCode = new Map<string, string>();
    const levels = [...new Set(rows.map((r) => r.level))].sort((a, b) => a - b);
    for (const level of levels) {
      const batch = rows
        .filter((r) => r.level === level)
        .map((r) =>
          this.accountRepo.create({
            tenantId,
            code: r.code,
            nameAr: r.nameAr,
            nameEn: r.nameEn,
            type: r.type,
            parentId: r.parentCode ? idByCode.get(r.parentCode) : undefined,
            level: r.level,
            allowPosting: r.allowPosting,
            isActive: true,
          }),
        );
      const saved = await this.accountRepo.save(batch);
      for (const account of saved) idByCode.set(account.code, account.id);
    }

    // 2. Default accounts for automatic posting
    const settings =
      (await this.settingsRepo.findOne({ where: { tenantId } })) ??
      this.settingsRepo.create({ tenantId });
    const filled: SettingsAccountKey[] = [];
    for (const row of rows) {
      if (!row.settingsKey) continue;
      (settings as unknown as Record<string, string>)[row.settingsKey] = idByCode.get(row.code)!;
      filled.push(row.settingsKey);
    }
    await this.settingsRepo.save(settings);

    // 3. First open fiscal year (an overlapping existing year is kept)
    const endDate = fiscalYearEnd(input.fiscalYearStart);
    let fiscalYear = await this.fiscalYearRepo.findOne({
      where: {
        tenantId,
        startDate: LessThanOrEqual(endDate),
        endDate: MoreThanOrEqual(input.fiscalYearStart),
      },
    });
    if (!fiscalYear) {
      fiscalYear = await this.fiscalYearRepo.save(
        this.fiscalYearRepo.create({
          tenantId,
          name: fiscalYearName(input.fiscalYearStart, endDate),
          startDate: input.fiscalYearStart,
          endDate,
          status: 'open',
        }),
      );
    }

    // 4. Default journals (existing ones of the same type are kept)
    const journals: Journal[] = [];
    for (const def of JOURNALS) {
      const current = await this.journalRepo.findOne({
        where: { tenantId, type: def.type },
        order: { createdAt: 'ASC' },
      });
      const defaultAccountId = def.defaultKey
        ? ((settings as unknown as Record<string, string>)[def.defaultKey] ?? undefined)
        : undefined;
      if (current) {
        if (!current.defaultAccountId && defaultAccountId) {
          current.defaultAccountId = defaultAccountId;
          journals.push(await this.journalRepo.save(current));
        } else {
          journals.push(current);
        }
        continue;
      }
      journals.push(
        await this.journalRepo.save(
          this.journalRepo.create({ tenantId, type: def.type, name: def.name, defaultAccountId }),
        ),
      );
    }

    // 5. Currencies (a global table): ensure base + common ones exist
    const baseCurrency = (input.baseCurrency ?? template.baseCurrency).toUpperCase();
    const currencies = await this.ensureCurrencies(baseCurrency);

    // 6. Remember the tenant's base currency and template
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (tenant) {
      tenant.settings = {
        ...(tenant.settings ?? {}),
        baseCurrency,
        chartTemplate: template.code,
      };
      if (!tenant.country) tenant.country = template.country;
      await this.tenantRepo.save(tenant);
    }

    return {
      template: template.code,
      accountsCreated: rows.length,
      postableAccounts: rows.filter((r) => r.allowPosting).length,
      settingsKeysFilled: filled,
      fiscalYear,
      journals,
      baseCurrency,
      currencies,
    };
  }

  private async ensureCurrencies(baseCurrency: string): Promise<string[]> {
    const wanted = [...COMMON_CURRENCIES];
    if (!wanted.some((c) => c.code === baseCurrency)) {
      wanted.unshift({ code: baseCurrency, nameAr: baseCurrency, nameEn: baseCurrency, symbol: baseCurrency });
    }
    const existing = await this.currencyRepo.find();
    const byCode = new Map(existing.map((c) => [c.code, c]));
    // The currencies table is shared by all tenants; only flag a base currency
    // when none is flagged yet (the tenant's own base is in tenant.settings).
    const hasBase = existing.some((c) => c.isBase);
    for (const def of wanted) {
      if (byCode.has(def.code)) continue;
      const saved = await this.currencyRepo.save(
        this.currencyRepo.create({ ...def, isBase: !hasBase && def.code === baseCurrency }),
      );
      byCode.set(saved.code, saved);
    }
    if (!hasBase) {
      const base = byCode.get(baseCurrency);
      if (base && !base.isBase) {
        base.isBase = true;
        await this.currencyRepo.save(base);
      }
    }
    return wanted.map((c) => c.code);
  }
}
