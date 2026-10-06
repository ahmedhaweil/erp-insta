import { computeDepreciationSchedule } from './fixed-assets.service';

describe('computeDepreciationSchedule', () => {
  it('depreciates straight-line to the salvage value at month-ends', () => {
    const lines = computeDepreciationSchedule({
      purchaseDate: '2026-01-15',
      purchaseValue: 1300,
      salvageValue: 100,
      usefulLifeMonths: 12,
    });

    expect(lines).toHaveLength(12);
    expect(lines[0]).toEqual({
      date: '2026-01-31',
      amount: 100,
      accumulated: 100,
      bookValue: 1200,
    });
    expect(lines[1].date).toBe('2026-02-28');
    expect(lines[11].bookValue).toBe(100);
    expect(lines[11].accumulated).toBe(1200);
  });

  it('absorbs rounding in the last month', () => {
    const lines = computeDepreciationSchedule({
      purchaseDate: '2026-01-01',
      purchaseValue: 1000,
      usefulLifeMonths: 3,
    });
    const total = lines.reduce((sum, l) => sum + l.amount, 0);
    expect(Math.round(total * 10000) / 10000).toBe(1000);
    expect(lines[2].bookValue).toBe(0);
  });

  it('front-loads declining balance and still ends at salvage value', () => {
    const lines = computeDepreciationSchedule({
      purchaseDate: '2026-01-01',
      purchaseValue: 12000,
      usefulLifeMonths: 24,
      depreciationMethod: 'declining_balance',
      decliningRate: 60,
    });

    expect(lines[0].amount).toBeGreaterThan(12000 / 24);
    expect(lines[0].amount).toBeGreaterThanOrEqual(lines[23].amount);
    expect(lines[lines.length - 1].bookValue).toBe(0);
  });
});
