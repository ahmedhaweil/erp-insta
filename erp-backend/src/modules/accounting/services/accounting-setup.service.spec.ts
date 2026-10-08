import { ConflictException } from '@nestjs/common';
import { getMetadataArgsStorage } from 'typeorm';
import { AccountingSetupService, fiscalYearEnd, fiscalYearName } from './accounting-setup.service';
import { AccountingSettings } from '../entities/accounting-settings.entity';
import { AccountType } from '../entities/account.entity';
import { CHART_TEMPLATES, expandTemplate, parentCode } from '../setup/chart-templates';

/** Every *AccountId column of the settings entity, read from TypeORM metadata. */
function settingsKeys(): string[] {
  return getMetadataArgsStorage()
    .columns.filter((c) => c.target === AccountingSettings)
    .map((c) => c.propertyName)
    .filter((p) => p.endsWith('AccountId'));
}

describe('chart templates', () => {
  it('derives parents from the 1/2/4/6-digit numbering', () => {
    expect(parentCode('1')).toBeNull();
    expect(parentCode('12')).toBe('1');
    expect(parentCode('1201')).toBe('12');
    expect(parentCode('120101')).toBe('1201');
  });

  for (const template of Object.values(CHART_TEMPLATES)) {
    describe(template.code, () => {
      const accounts = expandTemplate(template);

      it('has unique codes and only 6-digit postable leaves', () => {
        const codes = accounts.map((a) => a.code);
        expect(new Set(codes).size).toBe(codes.length);
        for (const a of accounts) {
          expect(a.allowPosting).toBe(a.code.length === 6);
          expect(a.nameAr).toBeTruthy();
          expect(a.nameEn).toBeTruthy();
        }
      });

      it('maps every accounting settings key exactly once to a postable leaf', () => {
        const keys = settingsKeys();
        expect(keys.length).toBeGreaterThanOrEqual(36);
        for (const key of keys) {
          const matches = accounts.filter((a) => a.settingsKey === key);
          expect({ key, count: matches.length }).toEqual({ key, count: 1 });
          expect(matches[0].allowPosting).toBe(true);
        }
      });

      it('gives default accounts the right nature', () => {
        const typeOf = (key: string) => accounts.find((a) => a.settingsKey === key)!.type;
        expect(typeOf('receivableAccountId')).toBe(AccountType.ASSET);
        expect(typeOf('cashAccountId')).toBe(AccountType.ASSET);
        expect(typeOf('payableAccountId')).toBe(AccountType.LIABILITY);
        expect(typeOf('outputTaxAccountId')).toBe(AccountType.LIABILITY);
        expect(typeOf('retainedEarningsAccountId')).toBe(AccountType.EQUITY);
        expect(typeOf('salesAccountId')).toBe(AccountType.REVENUE);
        expect(typeOf('cogsAccountId')).toBe(AccountType.EXPENSE);
      });

      it('keeps the cash-flow conventions (11 non-current assets, 21 non-current liabilities)', () => {
        expect(accounts.find((a) => a.code === '11')!.nameEn).toMatch(/non-current assets/i);
        expect(accounts.find((a) => a.code === '21')!.nameEn).toMatch(/non-current liabilities/i);
      });
    });
  }
});

describe('fiscal year helpers', () => {
  it('computes the last day of a 12-month year', () => {
    expect(fiscalYearEnd('2026-01-01')).toBe('2026-12-31');
    expect(fiscalYearEnd('2026-07-01')).toBe('2027-06-30');
    expect(fiscalYearEnd('2024-03-01')).toBe('2025-02-28');
    expect(fiscalYearName('2026-01-01', '2026-12-31')).toBe('FY 2026');
    expect(fiscalYearName('2026-07-01', '2027-06-30')).toBe('FY 2026/2027');
  });
});

describe('AccountingSetupService', () => {
  let service: AccountingSetupService;
  let accountRepo: Record<string, jest.Mock>;
  let settingsRepo: Record<string, jest.Mock>;
  let fiscalYearRepo: Record<string, jest.Mock>;
  let journalRepo: Record<string, jest.Mock>;
  let currencyRepo: Record<string, jest.Mock>;
  let tenantRepo: Record<string, jest.Mock>;
  let saved: any[];
  let seq: number;

  beforeEach(() => {
    saved = [];
    seq = 0;
    accountRepo = {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((x) => x),
      save: jest.fn(async (batch: any[]) =>
        batch.map((a) => {
          const row = { ...a, id: `acc-${a.code}` };
          saved.push(row);
          return row;
        }),
      ),
    };
    settingsRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((x) => ({ ...x })),
      save: jest.fn(async (x) => x),
    };
    fiscalYearRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ id: 'fy-1', ...x })),
    };
    journalRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ id: `j-${++seq}`, ...x })),
    };
    currencyRepo = {
      find: jest.fn().mockResolvedValue([{ code: 'USD', isBase: false }]),
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => x),
    };
    tenantRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 't1', settings: { foo: 1 } }),
      save: jest.fn(async (x) => x),
    };
    service = new AccountingSetupService(
      accountRepo as any,
      settingsRepo as any,
      fiscalYearRepo as any,
      journalRepo as any,
      currencyRepo as any,
      tenantRepo as any,
    );
  });

  it('refuses to run when the tenant already has accounts', async () => {
    accountRepo.count.mockResolvedValue(3);
    await expect(
      service.setup('t1', { template: 'eg', fiscalYearStart: '2026-01-01' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(accountRepo.save).not.toHaveBeenCalled();
  });

  it('creates the chart parents-first, fills settings, fiscal year, journals and currencies', async () => {
    const result = await service.setup('t1', { template: 'sa', fiscalYearStart: '2026-01-01' });

    // one insert per level, parents linked by id
    expect(accountRepo.save).toHaveBeenCalledTimes(4);
    const leaf = saved.find((a) => a.code === '120201');
    expect(leaf.parentId).toBe('acc-1202');
    expect(leaf.allowPosting).toBe(true);
    expect(saved.find((a) => a.code === '1202').allowPosting).toBe(false);
    expect(saved.find((a) => a.code === '1').parentId).toBeUndefined();

    const settings = settingsRepo.save.mock.calls[0][0];
    for (const key of settingsKeys()) expect(settings[key]).toMatch(/^acc-\d{6}$/);
    expect(settings.receivableAccountId).toBe('acc-120201');
    expect(result.settingsKeysFilled.length).toBe(settingsKeys().length);

    expect(fiscalYearRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: '2026-01-01', endDate: '2026-12-31', status: 'open' }),
    );
    expect(result.journals.map((j) => j.type)).toEqual(['sale', 'purchase', 'cash', 'bank', 'general']);
    expect(result.journals.find((j) => j.type === 'cash')!.defaultAccountId).toBe('acc-120101');

    expect(result.baseCurrency).toBe('SAR');
    const createdCodes = currencyRepo.create.mock.calls.map((c) => c[0].code);
    expect(createdCodes).toEqual(['EGP', 'SAR', 'EUR', 'AED']);
    expect(currencyRepo.create.mock.calls.find((c) => c[0].code === 'SAR')![0].isBase).toBe(true);

    expect(tenantRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        country: 'SA',
        settings: { foo: 1, baseCurrency: 'SAR', chartTemplate: 'sa' },
      }),
    );
  });

  it('keeps an existing overlapping fiscal year and existing journals', async () => {
    fiscalYearRepo.findOne.mockResolvedValue({ id: 'fy-old', name: 'FY 2026' });
    journalRepo.findOne.mockResolvedValue({ id: 'j-old', type: 'sale', defaultAccountId: 'x' });
    const result = await service.setup('t1', {
      template: 'eg',
      fiscalYearStart: '2026-01-01',
      baseCurrency: 'usd',
    });
    expect(fiscalYearRepo.save).not.toHaveBeenCalled();
    expect(result.fiscalYear.id).toBe('fy-old');
    expect(journalRepo.save).not.toHaveBeenCalled();
    expect(result.baseCurrency).toBe('USD');
  });
});
