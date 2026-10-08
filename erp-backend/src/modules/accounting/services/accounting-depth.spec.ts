import { BadRequestException } from '@nestjs/common';
import { ConflictException } from '@nestjs/common';
import { occurrenceDate, RecurringEntriesService } from './recurring-entries.service';
import { computeDeferralLines, recognitionLines } from './deferrals.service';
import {
  computeRevaluation,
  nextPeriodStart,
  revaluationLines,
} from './fx-revaluation.service';
import { balanceOpening } from './opening-balances.service';
import { periodEnd } from './period-closing.service';
import { RecurringEntryStatus, RecurringFrequency } from '../entities/recurring-entry.entity';
import { DeferralType } from '../entities/deferral-schedule.entity';

describe('recurring entries', () => {
  it('computes occurrences from the start date without day drift', () => {
    const t = { frequency: RecurringFrequency.MONTHLY, startDate: '2026-01-31', intervalDays: null };
    expect([0, 1, 2].map((i) => occurrenceDate(t, i))).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(occurrenceDate({ ...t, frequency: RecurringFrequency.QUARTERLY }, 1)).toBe('2026-04-30');
    expect(occurrenceDate({ ...t, frequency: RecurringFrequency.YEARLY }, 1)).toBe('2027-01-31');
    expect(occurrenceDate({ ...t, frequency: RecurringFrequency.DAYS, intervalDays: 10 }, 2)).toBe('2026-02-20');
  });

  describe('runDue', () => {
    let service: RecurringEntriesService;
    let template: any;
    let runs: Map<string, any>;
    let journalEntries: any;

    beforeEach(() => {
      runs = new Map();
      template = {
        id: 'tpl',
        tenantId: 't',
        name: 'Rent',
        frequency: RecurringFrequency.MONTHLY,
        startDate: '2026-01-31',
        endDate: '2026-03-31',
        nextRunDate: '2026-01-31',
        runCount: 0,
        autoPost: true,
        exchangeRate: 1,
        status: RecurringEntryStatus.ACTIVE,
        createdBy: 'u',
        lines: [
          { accountId: 'rent', debit: 100, credit: 0 },
          { accountId: 'accrued', debit: 0, credit: 100 },
        ],
      };
      const templateRepo = {
        find: jest.fn(async () => (template.status === 'active' ? [template] : [])),
        save: jest.fn(async (t) => t),
      };
      const runRepo = {
        findOne: jest.fn(async ({ where }) => runs.get(where.runDate) ?? null),
        save: jest.fn(async (r) => runs.set(r.runDate, r)),
        create: jest.fn((r) => r),
      };
      journalEntries = {
        createAndPost: jest.fn(async (_t, _u, dto) => ({ id: `je-${dto.date}`, refNumber: dto.date, status: 'posted' })),
        create: jest.fn(),
      };
      const autoPosting = {
        resolveJournal: jest.fn(async () => ({ id: 'general' })),
        toBaseCurrency: jest.fn((lines) => lines),
      };
      service = new RecurringEntriesService(
        templateRepo as any,
        {} as any,
        runRepo as any,
        journalEntries,
        autoPosting as any,
      );
    });

    it('generates each due occurrence once and stops at the end date', async () => {
      const first = await service.runDue('t', '2026-02-28');
      expect(first.results[0].generated.map((g) => g.date)).toEqual(['2026-01-31', '2026-02-28']);
      expect(template.nextRunDate).toBe('2026-03-31');

      // Re-running for the same date generates nothing.
      template.runCount = 0; // even if the counter were stale, the run log prevents duplicates
      const again = await service.runDue('t', '2026-02-28');
      expect(again.results).toEqual([]);
      expect(journalEntries.createAndPost).toHaveBeenCalledTimes(2);

      await service.runDue('t', '2026-12-31');
      expect(journalEntries.createAndPost).toHaveBeenCalledTimes(3);
      expect(template.status).toBe(RecurringEntryStatus.DONE);
      expect(template.nextRunDate).toBeNull();
    });

    it('reports a locked period and keeps the occurrence due', async () => {
      journalEntries.createAndPost.mockRejectedValueOnce(new ConflictException('The period is locked'));
      const result = await service.runDue('t', '2026-02-28');
      expect(result.results[0].error).toContain('locked');
      expect(template.nextRunDate).toBe('2026-01-31');
    });
  });
});

describe('deferrals', () => {
  it('splits the amount over month ends; the last month absorbs rounding', () => {
    const lines = computeDeferralLines(1000, '2026-02-15', 3);
    expect(lines.map((l) => l.date)).toEqual(['2026-02-28', '2026-03-31', '2026-04-30']);
    expect(lines.map((l) => l.amount)).toEqual([333.33, 333.33, 333.34]);
  });

  it('recognises revenue from the liability and expenses from the prepaid asset', () => {
    const base = { deferralAccountId: 'deferral', plAccountId: 'pl', name: 'x' } as any;
    const revenue = recognitionLines({ ...base, type: DeferralType.REVENUE }, 50);
    expect(revenue).toEqual([
      expect.objectContaining({ accountId: 'deferral', debit: 50, credit: 0 }),
      expect.objectContaining({ accountId: 'pl', debit: 0, credit: 50 }),
    ]);
    const expense = recognitionLines({ ...base, type: DeferralType.EXPENSE }, 50);
    expect(expense[0]).toEqual(expect.objectContaining({ accountId: 'pl', debit: 50 }));
    expect(expense[1]).toEqual(expect.objectContaining({ accountId: 'deferral', credit: 50 }));
  });
});

describe('fx revaluation', () => {
  const docs = [
    { kind: 'receivable' as const, currencyId: 'USD', rate: 48, residual: 500 },
    { kind: 'receivable' as const, currencyId: 'USD', rate: 49, residual: -100 }, // credit note
    { kind: 'payable' as const, currencyId: 'USD', rate: 48, residual: 300 },
    { kind: 'payable' as const, currencyId: 'EUR', rate: 52, residual: 10 },
  ];
  const treasuries = [
    { treasuryId: 'tr', label: 'USD bank', accountId: 'bank', currencyId: 'USD', balance: 1000, baseBalance: 48000 },
  ];

  it('revalues open balances per currency and treasuries at the closing rate', () => {
    const { items, missingRates } = computeRevaluation(docs, treasuries, { USD: 50 }, {
      receivable: 'ar',
      payable: 'ap',
    });
    expect(missingRates).toEqual(['EUR']);
    const ar = items.find((i) => i.kind === 'receivable')!;
    expect(ar).toEqual(expect.objectContaining({ foreignAmount: 400, bookedBase: 19100, revaluedBase: 20000, difference: 900, gainLoss: 900 }));
    const ap = items.find((i) => i.kind === 'payable')!;
    expect(ap).toEqual(expect.objectContaining({ difference: 600, gainLoss: -600 }));
    const bank = items.find((i) => i.kind === 'treasury')!;
    expect(bank).toEqual(expect.objectContaining({ difference: 2000, gainLoss: 2000 }));
  });

  it('posts balanced lines with zero currency amounts', () => {
    const { items } = computeRevaluation(docs, treasuries, { USD: 47, EUR: 52 }, { receivable: 'ar', payable: 'ap' });
    const lines = revaluationLines(items, 'gain', 'loss');
    const debit = lines.reduce((s, l) => s + (l.debit ?? 0), 0);
    const credit = lines.reduce((s, l) => s + (l.credit ?? 0), 0);
    expect(debit).toBeCloseTo(credit, 6);
    expect(lines.every((l) => l.amountCurrency === 0)).toBe(true);
    // Rate fell: receivable down (loss), payable down (gain).
    expect(lines).toContainEqual(expect.objectContaining({ accountId: 'ar', credit: 300 })); // 19100 -> 18800
    expect(lines).toContainEqual(expect.objectContaining({ accountId: 'ap', debit: 300 }));
    expect(lines).toContainEqual(expect.objectContaining({ accountId: 'gain', credit: 300 }));
  });

  it('reverses on the first day of the next period', () => {
    expect(nextPeriodStart('2026-09-30')).toBe('2026-10-01');
    expect(nextPeriodStart('2026-12-15')).toBe('2027-01-01');
  });
});

describe('opening balances and closing', () => {
  it('balances the opening entry against equity', () => {
    const lines = balanceOpening(
      [
        { accountId: 'land', debit: 100 },
        { accountId: 'capital', credit: 60 },
      ],
      'equity',
    );
    expect(lines[2]).toEqual({ accountId: 'equity', debit: 0, credit: 40 });
    expect(balanceOpening([{ accountId: 'loan', credit: 10 }], 'equity')[1]).toEqual({
      accountId: 'equity',
      debit: 10,
      credit: 0,
    });
    expect(() => balanceOpening([{ accountId: 'x' }], 'equity')).toThrow(BadRequestException);
  });

  it('locks up to the last day of the month', () => {
    expect(periodEnd('2026-02')).toBe('2026-02-28');
    expect(periodEnd('2024-02')).toBe('2024-02-29');
    expect(periodEnd('2026-12')).toBe('2026-12-31');
  });
});
