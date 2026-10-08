import { PayrollCalculator, PayslipInput } from './payroll-calculator';
import { mergeRules } from './payroll-rules';
import { computeAttendance } from './attendance-calculator';

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

describe('PayrollCalculator - Egyptian year-to-date tax true-up', () => {
  const none = { monthsBefore: 0, regularTaxableBefore: 0, irregularTaxableBefore: 0, taxBefore: 0 };

  it('equals the plain annualisation for a constant salary', () => {
    // 10,000 a month -> 120,000 - 20,000 exemption = 100,000 -> 9,750 a year.
    expect(calc.egyptCumulativeTax(none, 10000, 0).monthlyTax).toBe(812.5);
    expect(
      calc.egyptCumulativeTax(
        { monthsBefore: 1, regularTaxableBefore: 10000, irregularTaxableBefore: 0, taxBefore: 812.5 },
        10000,
        0,
      ).monthlyTax,
    ).toBe(812.5);
    const slip = calc.computePayslip(baseInput({ taxYtd: none }));
    const plain = calc.computePayslip(baseInput());
    expect(slip.incomeTax.monthlyTax).toBe(plain.incomeTax.monthlyTax);
    expect(slip.incomeTax.method).toBe('cumulative');
  });

  it('taxes a bonus at the marginal rate instead of annualising it', () => {
    const result = calc.egyptCumulativeTax(
      { monthsBefore: 2, regularTaxableBefore: 20000, irregularTaxableBefore: 0, taxBefore: 1625 },
      10000,
      30000,
    );
    // A = 120,000; tax(100,000) = 9,750; tax(130,000) = 15,750
    // due = 9,750 x 3/12 + (15,750 - 9,750) = 8,437.50 ; month = 8,437.50 - 1,625
    expect(result).toMatchObject({
      months: 3,
      projectedAnnualRegular: 120000,
      annualTaxRegular: 9750,
      annualTaxWithIrregular: 15750,
      taxDueYtd: 8437.5,
      monthlyTax: 6812.5,
    });
    // The month alone annualised would tax 40,000 x 12: 7,479.17.
    expect(calc.egyptMonthlyTax(40000).monthlyTax).toBe(7479.17);
  });

  it('splits taxable pay into regular and one-off parts on the payslip', () => {
    const slip = calc.computePayslip(
      baseInput({ additions: [{ description: 'Bonus', amount: 5000, taxable: true }], taxYtd: none }),
    );
    expect(slip.incomeTax.irregularTaxable).toBe(5000);
    expect(slip.incomeTax.regularTaxable).toBe(10680); // 12,000 - 1,320 insurance
  });

  it('refunds over-withheld tax in the year-end true-up', () => {
    const result = calc.egyptCumulativeTax(
      { monthsBefore: 11, regularTaxableBefore: 110000, irregularTaxableBefore: 0, taxBefore: 20000 },
      10000,
      0,
    );
    expect(result.taxDueYtd).toBe(9750);
    expect(result.monthlyTax).toBe(-10250);
  });
});

describe('PayrollCalculator - Martyrs fund (Law 4/2021)', () => {
  const enabled = (bearer: 'employee' | 'employer') =>
    new PayrollCalculator(mergeRules({ EG: { martyrsFund: { enabled: true, rate: 0.0005, bearer } } }));

  it('is off by default', () => {
    expect(calc.computePayslip(baseInput()).martyrsFund.employee).toBe(0);
  });

  it('deducts 0.05% of the gross from the employee', () => {
    const slip = enabled('employee').computePayslip(baseInput());
    const plain = calc.computePayslip(baseInput());
    expect(slip.martyrsFund).toMatchObject({ base: 12000, employee: 6, employer: 0 });
    expect(slip.net).toBe(Math.round((plain.net - 6) * 100) / 100);
    expect(slip.totalDeductions).toBe(Math.round((plain.totalDeductions + 6) * 100) / 100);
  });

  it('can be borne by the employer without touching the net', () => {
    const slip = enabled('employer').computePayslip(baseInput());
    expect(slip.martyrsFund).toMatchObject({ employee: 0, employer: 6 });
    expect(slip.net).toBe(calc.computePayslip(baseInput()).net);
  });

  it('does not apply to Saudi payroll', () => {
    expect(enabled('employee').computePayslip(baseInput({ country: 'SA' })).martyrsFund.employee).toBe(0);
  });
});

describe('PayrollCalculator - Egyptian contractual gratuity', () => {
  it('awards the configured months per service year', () => {
    const c = new PayrollCalculator(mergeRules({ EG: { contractualGratuityMonthsPerYear: 1 } }));
    const input = {
      country: 'EG' as const,
      monthlyWage: 10000,
      startDate: '2021-01-01',
      endDate: '2025-12-31', // 1,826 days
      reason: 'termination' as const,
    };
    const result = c.gratuity(input);
    expect(result.amount).toBe(50027.4); // 1826 / 365 x 10,000
    expect(result.statutory).toBe(false);
    expect(c.gratuity({ ...input, reason: 'dismissal_article_80' }).amount).toBe(0);
    expect(calc.gratuity(input).amount).toBe(0); // default: none
  });
});

describe('computeAttendance - half-day leave', () => {
  const schedule = { dailyHours: 8, startTime: '09:00', weekendDays: [5, 6], graceMinutes: 0 };

  it('counts half a leave day and half a working day', () => {
    const summary = computeAttendance({
      from: '2026-10-04',
      to: '2026-10-05',
      schedule,
      trackAttendance: true,
      holidays: new Set(),
      leaveDays: new Map([
        ['2026-10-04', { paid: false, fraction: 0.5 }],
        ['2026-10-05', { paid: true, fraction: 0.5 }],
      ]),
      records: [{ date: '2026-10-04', checkIn: '13:00', checkOut: '18:00' }],
    });
    expect(summary.unpaidLeaveDays).toBe(0.5);
    expect(summary.paidLeaveDays).toBe(0.5);
    expect(summary.presentDays).toBe(0.5);
    expect(summary.absenceDays).toBe(0.5); // no attendance on the 5th
    expect(summary.overtimeHours).toBe(1); // 5h worked for a 4h half day
  });

  it('only counts the leave fraction when attendance is not tracked', () => {
    const summary = computeAttendance({
      from: '2026-10-04',
      to: '2026-10-04',
      schedule,
      trackAttendance: false,
      holidays: new Set(),
      leaveDays: new Map([['2026-10-04', { paid: false, fraction: 0.5 }]]),
      records: [],
    });
    expect(summary).toMatchObject({ unpaidLeaveDays: 0.5, absenceDays: 0, presentDays: 0 });
  });
});
