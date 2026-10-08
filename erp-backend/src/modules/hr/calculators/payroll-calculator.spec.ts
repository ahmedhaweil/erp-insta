import { PayrollCalculator, PayslipInput } from './payroll-calculator';
import { DEFAULT_PAYROLL_RULES, mergeRules } from './payroll-rules';
import { computeAttendance, countWorkingDays, workedHours } from './attendance-calculator';

const calc = new PayrollCalculator();

const baseInput = (overrides: Partial<PayslipInput> = {}): PayslipInput => ({
  country: 'EG',
  basicSalary: 10000,
  allowances: [{ code: 'transport', name: 'Transport', amount: 2000 }],
  daysInMonth: 31,
  employedDays: 31,
  dailyHours: 8,
  overtimeHours: 0,
  absenceDays: 0,
  unpaidLeaveDays: 0,
  lateMinutes: 0,
  additions: [],
  deductions: [],
  socialInsurance: { enrolled: true, insurableWage: null, isNational: true },
  loanInstallments: [],
  ...overrides,
});

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('PayrollCalculator - Egypt', () => {
  describe('annual salary tax (Law 7/2024)', () => {
    it.each([
      [0, 0],
      [30000, 0],
      [40000, 0],
      [50000, 1000],
      [100000, 9750],
      [600000, 124750],
    ])('taxes %d at %d with all brackets', (income, tax) => {
      expect(calc.egyptAnnualTax(income)).toBe(tax);
    });

    it('drops the exempt bracket above 600,000 (first 55,000 at 10%)', () => {
      // 55k*10% + 15k*15% + 130k*20% + 200k*22.5% + 250k*25%
      expect(calc.egyptAnnualTax(650000)).toBe(141250);
    });

    it('taxes the first 70,000 at 15% above 700,000', () => {
      expect(calc.egyptAnnualTax(750000)).toBe(169000);
    });

    it('taxes the first 200,000 at 20% above 800,000', () => {
      expect(calc.egyptAnnualTax(850000)).toBe(197500);
    });

    it('taxes the first 400,000 at 22.5% above 900,000', () => {
      expect(calc.egyptAnnualTax(1000000)).toBe(240000);
    });

    it('taxes the first 1,200,000 at 25% and the rest at 27.5% above 1,200,000', () => {
      expect(calc.egyptAnnualTax(1500000)).toBe(382500);
    });

    it('annualises the monthly taxable pay and deducts the 20,000 personal exemption', () => {
      const result = calc.egyptMonthlyTax(10680);
      expect(result.annualTaxable).toBe(108160);
      expect(result.annualTax).toBe(11382);
      expect(result.monthlyTax).toBe(948.5);
    });
  });

  describe('social insurance (Law 148/2019)', () => {
    it('applies 11% / 18.75% on the insurable wage', () => {
      expect(calc.egyptSocialInsurance(12000)).toEqual({
        wage: 12000,
        employeeRate: 0.11,
        employerRate: 0.1875,
        employee: 1320,
        employer: 2250,
      });
    });

    it('clamps the wage to the maximum and minimum insurable wage', () => {
      expect(calc.egyptSocialInsurance(20000)).toMatchObject({ wage: 14500, employee: 1595, employer: 2718.75 });
      expect(calc.egyptSocialInsurance(1000)).toMatchObject({ wage: 2300, employee: 253, employer: 431.25 });
    });

    it('uses tenant overrides when the yearly limits change', () => {
      const custom = new PayrollCalculator(mergeRules({ EG: { maxInsurableWage: 16700 } }));
      expect(custom.egyptSocialInsurance(20000).wage).toBe(16700);
    });
  });

  it('computes a full monthly payslip', () => {
    const slip = calc.computePayslip(baseInput());
    expect(slip.gross).toBe(12000);
    expect(slip.socialInsurance.employee).toBe(1320);
    expect(slip.socialInsurance.employer).toBe(2250);
    expect(slip.incomeTax.monthlyTax).toBe(948.5);
    expect(slip.net).toBe(9731.5);
    expect(slip.totalDeductions).toBe(2268.5);
  });

  it('uses the contractual insurable wage when set', () => {
    const slip = calc.computePayslip(
      baseInput({ socialInsurance: { enrolled: true, insurableWage: 5000, isNational: true } }),
    );
    expect(slip.socialInsurance.employee).toBe(550);
  });

  it('skips insurance for employees not enrolled', () => {
    const slip = calc.computePayslip(
      baseInput({ socialInsurance: { enrolled: false, insurableWage: null, isNational: true } }),
    );
    expect(slip.socialInsurance.employee).toBe(0);
    expect(slip.socialInsurance.employer).toBe(0);
  });

  it('excludes non-taxable additions from the tax base', () => {
    const taxable = calc.computePayslip(
      baseInput({ additions: [{ description: 'Bonus', amount: 1000, taxable: true }] }),
    );
    const exempt = calc.computePayslip(
      baseInput({ additions: [{ description: 'Meal', amount: 1000, taxable: false }] }),
    );
    expect(taxable.gross).toBe(13000);
    expect(exempt.gross).toBe(13000);
    expect(taxable.incomeTax.monthlyTax).toBeGreaterThan(exempt.incomeTax.monthlyTax);
    expect(exempt.incomeTax.monthlyTax).toBe(948.5);
  });

  it('prorates the fixed salary for a mid-month joiner', () => {
    const slip = calc.computePayslip(baseInput({ daysInMonth: 30, employedDays: 15 }));
    expect(slip.earnings.basic).toBe(5000);
    expect(slip.earnings.allowancesTotal).toBe(1000);
    expect(slip.gross).toBe(6000);
  });
});

describe('PayrollCalculator - Saudi Arabia', () => {
  const saudi = (overrides: Partial<PayslipInput> = {}) =>
    baseInput({
      country: 'SA',
      basicSalary: 10000,
      allowances: [
        { code: 'housing', name: 'Housing', amount: 2500 },
        { code: 'transport', name: 'Transport', amount: 500 },
      ],
      ...overrides,
    });

  it('charges GOSI on basic + housing for Saudis (9.75% / 11.75%) and no income tax', () => {
    const slip = calc.computePayslip(saudi());
    expect(slip.socialInsurance).toMatchObject({ wage: 12500, employee: 1218.75, employer: 1468.75 });
    expect(slip.incomeTax.monthlyTax).toBe(0);
    expect(slip.net).toBe(11781.25);
  });

  it('charges only the 2% occupational hazards to the employer for non-Saudis', () => {
    const slip = calc.computePayslip(
      saudi({ socialInsurance: { enrolled: true, insurableWage: null, isNational: false } }),
    );
    expect(slip.socialInsurance).toMatchObject({ employee: 0, employer: 250 });
    expect(slip.net).toBe(13000);
  });

  it('caps the contributory wage at 45,000', () => {
    expect(calc.saudiGosi(60000, true)).toMatchObject({ wage: 45000, employee: 4387.5 });
  });

  it('applies attendance deductions and overtime', () => {
    const slip = calc.computePayslip(
      saudi({
        basicSalary: 9000,
        allowances: [],
        absenceDays: 2,
        unpaidLeaveDays: 1,
        lateMinutes: 30,
        overtimeHours: 4,
        socialInsurance: { enrolled: true, insurableWage: null, isNational: false },
      }),
    );
    expect(slip.dailyRate).toBe(300);
    expect(slip.hourlyRate).toBe(37.5);
    expect(slip.attendanceDeductions).toMatchObject({ absence: 600, unpaidLeave: 300, late: 18.75, total: 918.75 });
    expect(slip.earnings.overtimePay).toBe(225);
    expect(slip.gross).toBe(8306.25);
    expect(slip.socialInsurance.employer).toBe(180);
  });
});

describe('PayrollCalculator - deductions', () => {
  it('deducts loan installments and one-off deductions', () => {
    const slip = calc.computePayslip(
      baseInput({
        country: 'SA',
        allowances: [],
        socialInsurance: { enrolled: false, insurableWage: null, isNational: false },
        deductions: [{ description: 'Penalty', amount: 500 }],
        loanInstallments: [
          { id: 'i1', loanId: 'l1', amount: 1000 },
          { id: 'i2', loanId: 'l2', amount: 750 },
        ],
      }),
    );
    expect(slip.loanDeduction).toBe(1750);
    expect(slip.otherDeductionsTotal).toBe(500);
    expect(slip.net).toBe(7750);
  });

  it('only recovers loans up to the available net pay and reports the shortfall', () => {
    const slip = calc.computePayslip(
      baseInput({
        country: 'SA',
        basicSalary: 3000,
        allowances: [],
        socialInsurance: { enrolled: false, insurableWage: null, isNational: false },
        loanInstallments: [
          { id: 'i1', loanId: 'l1', amount: 2000 },
          { id: 'i2', loanId: 'l1', amount: 2000 },
        ],
      }),
    );
    expect(slip.loanAllocations).toEqual([
      { id: 'i1', loanId: 'l1', amount: 2000 },
      { id: 'i2', loanId: 'l1', amount: 1000 },
    ]);
    expect(slip.loanShortfall).toBe(1000);
    expect(slip.net).toBe(0);
  });

  it('never lets attendance deductions take the gross below zero', () => {
    const slip = calc.computePayslip(
      baseInput({ country: 'SA', allowances: [], absenceDays: 40, socialInsurance: { enrolled: false, isNational: true } }),
    );
    expect(slip.gross).toBe(0);
    expect(slip.net).toBe(0);
  });
});

describe('PayrollCalculator - end-of-service gratuity', () => {
  it('gives half a month per year for the first five years (Saudi art. 84)', () => {
    const result = calc.gratuity({
      country: 'SA',
      monthlyWage: 10000,
      startDate: '2020-01-01',
      endDate: addDays('2020-01-01', 1094),
      reason: 'termination',
    });
    expect(result.serviceYears).toBe(3);
    expect(result.amount).toBe(15000);
  });

  it('applies the article 85 resignation reductions', () => {
    const threeYears = calc.gratuity({
      country: 'SA',
      monthlyWage: 10000,
      startDate: '2020-01-01',
      endDate: addDays('2020-01-01', 1094),
      reason: 'resignation',
    });
    expect(threeYears.amount).toBe(5000);

    const eightYears = calc.gratuity({
      country: 'SA',
      monthlyWage: 10000,
      startDate: '2015-01-01',
      endDate: addDays('2015-01-01', 8 * 365 - 1),
      reason: 'resignation',
    });
    expect(eightYears.fullAward).toBe(55000);
    expect(eightYears.amount).toBe(36666.67);

    const oneYear = calc.gratuity({
      country: 'SA',
      monthlyWage: 10000,
      startDate: '2024-01-01',
      endDate: '2024-12-31',
      reason: 'resignation',
    });
    expect(oneYear.amount).toBe(0);
  });

  it('pays the full award for article 87 resignations and nothing for article 80 dismissals', () => {
    const input = {
      country: 'SA' as const,
      monthlyWage: 10000,
      startDate: '2020-01-01',
      endDate: addDays('2020-01-01', 1094),
    };
    expect(calc.gratuity({ ...input, reason: 'resignation_article_87' }).amount).toBe(15000);
    expect(calc.gratuity({ ...input, reason: 'dismissal_article_80' }).amount).toBe(0);
  });

  it('returns zero with a note in Egypt (not statutory)', () => {
    const result = calc.gratuity({
      country: 'EG',
      monthlyWage: 10000,
      startDate: '2015-01-01',
      endDate: '2025-01-01',
      reason: 'termination',
    });
    expect(result.statutory).toBe(false);
    expect(result.amount).toBe(0);
    expect(result.notes.length).toBeGreaterThan(0);
  });
});

describe('payroll rules', () => {
  it('merges tenant overrides into the defaults and replaces arrays', () => {
    const rules = mergeRules({
      EG: { siEmployeeRate: 0.12, taxBrackets: [{ upTo: null, rate: 0.1 }] },
    });
    expect(rules.EG.siEmployeeRate).toBe(0.12);
    expect(rules.EG.siEmployerRate).toBe(DEFAULT_PAYROLL_RULES.EG.siEmployerRate);
    expect(rules.EG.taxBrackets).toHaveLength(1);
    expect(rules.SA).toEqual(DEFAULT_PAYROLL_RULES.SA);
    expect(DEFAULT_PAYROLL_RULES.EG.siEmployeeRate).toBe(0.11);
  });
});

describe('attendance calculator', () => {
  const schedule = { dailyHours: 8, startTime: '09:00', weekendDays: [5, 6], graceMinutes: 10 };

  it('computes late minutes, overtime, absences and leaves for a week', () => {
    const summary = computeAttendance({
      from: '2026-10-01', // Thursday
      to: '2026-10-07',
      schedule,
      trackAttendance: true,
      holidays: new Set(['2026-10-07']),
      leaveDays: new Map([['2026-10-06', false]]),
      records: [
        { date: '2026-10-01', checkIn: '09:05', checkOut: '18:05' }, // within grace, 1h overtime
        { date: '2026-10-02', checkIn: '10:00', checkOut: '14:00' }, // Friday: 4h overtime
        { date: '2026-10-04', checkIn: '09:30', checkOut: '17:30' }, // 30 minutes late
      ],
    });
    expect(summary).toMatchObject({
      workingDays: 4,
      presentDays: 2,
      absenceDays: 1,
      unpaidLeaveDays: 1,
      paidLeaveDays: 0,
      lateMinutes: 30,
      overtimeHours: 5,
    });
    expect(summary.days.find((d) => d.date === '2026-10-05')?.status).toBe('absent');
    expect(summary.days.find((d) => d.date === '2026-10-07')?.type).toBe('holiday');
  });

  it('counts only leaves when attendance is not tracked', () => {
    const summary = computeAttendance({
      from: '2026-10-01',
      to: '2026-10-07',
      schedule,
      trackAttendance: false,
      holidays: new Set(),
      leaveDays: new Map([
        ['2026-10-05', true],
        ['2026-10-06', false],
      ]),
      records: [],
    });
    expect(summary.absenceDays).toBe(0);
    expect(summary.paidLeaveDays).toBe(1);
    expect(summary.unpaidLeaveDays).toBe(1);
  });

  it('handles overnight shifts and counts working days', () => {
    expect(workedHours('22:00', '06:00')).toBe(8);
    expect(countWorkingDays('2026-10-01', '2026-10-07', [5, 6])).toBe(5);
  });
});
