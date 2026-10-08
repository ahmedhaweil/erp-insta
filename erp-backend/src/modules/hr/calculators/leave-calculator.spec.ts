import {
  accruedEntitlement,
  carryExpiryDate,
  lastCompletedMonthEnd,
  leaveLedger,
  LeavePolicy,
  yearEntitlement,
} from './leave-calculator';

describe('leave calculator', () => {
  const annual: LeavePolicy = { annualEntitlement: 21, seniorEntitlement: 30, seniorAfterYears: 10 };

  it('prorates the yearly entitlement for joiners and applies the senior entitlement', () => {
    expect(yearEntitlement(annual, '2020-01-01', 2026)).toBe(21);
    expect(yearEntitlement(annual, '2015-06-01', 2026)).toBe(30);
    expect(yearEntitlement(annual, '2026-07-02', 2026)).toBe(10.53); // 21 x 183 / 365
    expect(yearEntitlement(annual, '2027-01-01', 2026)).toBe(0);
  });

  it('finds the last completed month end', () => {
    expect(lastCompletedMonthEnd('2026-03-31')).toBe('2026-03-31');
    expect(lastCompletedMonthEnd('2026-03-15')).toBe('2026-02-28');
    expect(lastCompletedMonthEnd('2026-01-10')).toBe('2025-12-31');
  });

  it('accrues monthly entitlement at each month end', () => {
    const monthly: LeavePolicy = { ...annual, accrualMethod: 'monthly' };
    // Jan + Feb = 59 days of 365 -> 21 x 59 / 365 = 3.39
    expect(accruedEntitlement(monthly, '2020-01-01', 2026, '2026-03-15')).toBe(3.39);
    expect(accruedEntitlement(monthly, '2020-01-01', 2026, '2026-01-20')).toBe(0);
    expect(accruedEntitlement(monthly, '2020-01-01', 2026, '2026-12-31')).toBe(21);
    // Joiner on 1 July: July..September earned at 30 September.
    expect(accruedEntitlement(monthly, '2026-07-01', 2026, '2026-09-30')).toBe(5.29); // 21 x 92 / 365
    // Annual accrual: everything on 1 January.
    expect(accruedEntitlement(annual, '2020-01-01', 2026, '2026-01-02')).toBe(21);
  });

  it('keeps the plain balance without carry-forward', () => {
    const ledger = leaveLedger({
      policy: annual,
      hireDate: '2020-01-01',
      year: 2026,
      asOf: '2026-06-30',
      taken: [
        { date: '2025-03-01', days: 3 },
        { date: '2026-03-01', days: 8 },
      ],
      pending: [{ date: '2026-11-01', days: 2 }],
    });
    expect(ledger).toMatchObject({ entitlement: 21, carriedIn: 0, taken: 8, pending: 2, remaining: 13 });
  });

  it('carries unused days forward up to the cap', () => {
    const policy: LeavePolicy = { annualEntitlement: 21, carryForward: true, carryForwardMax: 10 };
    const ledger = leaveLedger({
      policy,
      hireDate: '2025-01-01',
      year: 2026,
      asOf: '2026-06-30',
      taken: [
        { date: '2025-05-01', days: 5 }, // 16 left in 2025 -> capped at 10
        { date: '2026-04-01', days: 7 },
      ],
    });
    expect(ledger.carriedIn).toBe(10);
    expect(ledger.remaining).toBe(24); // 10 + 21 - 7
    expect(ledger.carryOut).toBe(10);
  });

  it('carries without a cap when none is set', () => {
    const policy: LeavePolicy = { annualEntitlement: 21, carryForward: true, carryForwardMax: null };
    const ledger = leaveLedger({ policy, hireDate: '2024-01-01', year: 2026, asOf: '2026-01-15', taken: [] });
    // 2024: 21 -> 2025: 21 + 21 = 42 -> 2026 carried 42
    expect(ledger.carriedIn).toBe(42);
    expect(ledger.remaining).toBe(63);
  });

  it('expires carried days not used before the expiry date', () => {
    const policy: LeavePolicy = {
      annualEntitlement: 21,
      carryForward: true,
      carryForwardMax: 10,
      carryForwardExpiryMonths: 3,
    };
    const base = {
      policy,
      hireDate: '2025-01-01',
      year: 2026,
      taken: [
        { date: '2025-05-01', days: 11 }, // 10 carried
        { date: '2026-02-10', days: 4 }, // consumes 4 carried days
        { date: '2026-06-01', days: 2 }, // after expiry: from the new entitlement
      ],
    };
    expect(carryExpiryDate(policy, 2026)).toBe('2026-03-31');
    const before = leaveLedger({ ...base, asOf: '2026-03-01' });
    expect(before).toMatchObject({ carriedIn: 10, carriedUsed: 4, carriedExpired: 0 });
    const after = leaveLedger({ ...base, asOf: '2026-07-01' });
    expect(after).toMatchObject({ carriedIn: 10, carriedUsed: 4, carriedExpired: 6, taken: 6 });
    expect(after.remaining).toBe(19); // 10 + 21 - 6 taken - 6 expired
  });

  it('deducts encashed days', () => {
    const ledger = leaveLedger({
      policy: annual,
      hireDate: '2020-01-01',
      year: 2026,
      asOf: '2026-12-31',
      taken: [{ date: '2026-03-01', days: 5 }],
      encashed: [
        { year: 2026, days: 6 },
        { year: 2025, days: 2 },
      ],
    });
    expect(ledger).toMatchObject({ encashed: 6, remaining: 10 });
  });
});
