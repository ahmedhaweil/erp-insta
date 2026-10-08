import {
  DEFAULT_PAYROLL_RULES,
  EgyptRules,
  PayrollRules,
  TaxBracket,
} from './payroll-rules';

/**
 * Pure payroll engine: no database, no Nest dependencies. Every statutory
 * figure comes from the `PayrollRules` configuration so rates and brackets
 * can be updated per tenant without code changes.
 */

export type PayrollCountryCode = 'EG' | 'SA';

export interface AllowanceComponent {
  code: string;
  name: string;
  amount: number;
}

export interface PayslipAddition {
  description: string;
  amount: number;
  /** Egypt only: whether the addition is subject to salary tax. */
  taxable?: boolean;
}

export interface PayslipDeduction {
  description: string;
  amount: number;
}

export interface LoanDue {
  /** Installment id. */
  id: string;
  loanId: string;
  amount: number;
}

export interface PayslipInput {
  country: PayrollCountryCode;
  basicSalary: number;
  allowances: AllowanceComponent[];
  /** Calendar days of the payroll month. */
  daysInMonth: number;
  /** Calendar days of the month the employee was employed (joiners/leavers). */
  employedDays: number;
  dailyHours: number;
  overtimeHours: number;
  absenceDays: number;
  unpaidLeaveDays: number;
  lateMinutes: number;
  additions: PayslipAddition[];
  deductions: PayslipDeduction[];
  socialInsurance: {
    enrolled: boolean;
    /** Contractual insurable wage; when absent the wage is derived from the salary. */
    insurableWage?: number | null;
    /** Saudi payroll: whether the employee is a Saudi national. */
    isNational: boolean;
  };
  /** Pending loan installments due this month, oldest first. */
  loanInstallments: LoanDue[];
}

export interface SocialInsuranceResult {
  wage: number;
  employeeRate: number;
  employerRate: number;
  employee: number;
  employer: number;
}

export interface IncomeTaxResult {
  /** Monthly taxable amount (gross taxable earnings less employee insurance). */
  monthlyTaxable: number;
  /** Annualised taxable income after the personal exemption. */
  annualTaxable: number;
  annualTax: number;
  monthlyTax: number;
}

export interface PayslipResult {
  country: PayrollCountryCode;
  dailyRate: number;
  hourlyRate: number;
  prorationFactor: number;
  earnings: {
    basic: number;
    allowances: AllowanceComponent[];
    allowancesTotal: number;
    overtimeHours: number;
    overtimePay: number;
    additions: PayslipAddition[];
    additionsTotal: number;
  };
  attendanceDeductions: {
    absenceDays: number;
    absence: number;
    unpaidLeaveDays: number;
    unpaidLeave: number;
    lateMinutes: number;
    late: number;
    total: number;
  };
  gross: number;
  socialInsurance: SocialInsuranceResult;
  incomeTax: IncomeTaxResult;
  loanDeduction: number;
  loanAllocations: LoanDue[];
  /** Part of the due installments that did not fit in the net pay. */
  loanShortfall: number;
  otherDeductions: PayslipDeduction[];
  otherDeductionsTotal: number;
  totalDeductions: number;
  net: number;
}

export interface GratuityInput {
  country: PayrollCountryCode;
  /** Last monthly wage (basic + regular allowances). */
  monthlyWage: number;
  startDate: string;
  endDate: string;
  reason:
    | 'termination'
    | 'contract_end'
    | 'resignation'
    | 'resignation_article_87'
    | 'dismissal_article_80';
}

export interface GratuityResult {
  country: PayrollCountryCode;
  serviceDays: number;
  serviceYears: number;
  monthlyWage: number;
  firstFiveYearsAward: number;
  afterFiveYearsAward: number;
  fullAward: number;
  /** Fraction of the full award granted for the termination reason. */
  entitlementFactor: number;
  amount: number;
  statutory: boolean;
  notes: string[];
}

export const round2 = (value: number): number =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const sum = (values: number[]): number => values.reduce((s, v) => s + Number(v || 0), 0);

export class PayrollCalculator {
  constructor(private readonly rules: PayrollRules = DEFAULT_PAYROLL_RULES) {}

  // ---------------------------------------------------------------- Egypt

  /**
   * Egyptian social insurance (Law 148/2019): the insurable wage is clamped
   * to the yearly minimum/maximum and the employee and employer shares are
   * applied to it.
   */
  egyptSocialInsurance(insurableWage: number): SocialInsuranceResult {
    const r = this.rules.EG;
    const wage = round2(
      Math.min(Math.max(Number(insurableWage) || 0, r.minInsurableWage), r.maxInsurableWage),
    );
    return {
      wage,
      employeeRate: r.siEmployeeRate,
      employerRate: r.siEmployerRate,
      employee: round2(wage * r.siEmployeeRate),
      employer: round2(wage * r.siEmployerRate),
    };
  }

  /**
   * Egyptian annual salary tax (Law 91/2005 as amended by Law 7/2024) on the
   * annual taxable income AFTER the personal exemption.
   *
   * High incomes lose the lower brackets: when the taxable income exceeds a
   * tier threshold (600k, 700k, 800k, 900k, 1.2M) the income up to the upper
   * bound of the tier's start bracket is taxed at that bracket's rate.
   */
  egyptAnnualTax(annualTaxable: number): number {
    const r: EgyptRules = this.rules.EG;
    const income = Math.max(Number(annualTaxable) || 0, 0);
    if (income === 0) return 0;

    const tier = [...r.highIncomeTiers]
      .sort((a, b) => b.above - a.above)
      .find((t) => income > t.above);

    let brackets: TaxBracket[] = r.taxBrackets;
    if (tier && tier.startBracket > 0 && tier.startBracket < r.taxBrackets.length) {
      const start = r.taxBrackets[tier.startBracket];
      brackets = [{ upTo: start.upTo, rate: start.rate }, ...r.taxBrackets.slice(tier.startBracket + 1)];
    }

    let tax = 0;
    let lower = 0;
    for (const bracket of brackets) {
      const upper = bracket.upTo ?? Number.POSITIVE_INFINITY;
      if (income <= lower) break;
      const slice = Math.min(income, upper) - lower;
      tax += slice * bracket.rate;
      lower = upper;
    }
    return round2(tax);
  }

  /**
   * Monthly Egyptian salary tax by annualisation: the month's taxable pay
   * (taxable earnings less the employee insurance share) is multiplied by 12,
   * the personal exemption deducted, the annual tax computed and divided by 12.
   */
  egyptMonthlyTax(monthlyTaxable: number): IncomeTaxResult {
    const taxable = Math.max(round2(monthlyTaxable), 0);
    const annualTaxable = Math.max(round2(taxable * 12 - this.rules.EG.personalExemption), 0);
    const annualTax = this.egyptAnnualTax(annualTaxable);
    return {
      monthlyTaxable: taxable,
      annualTaxable,
      annualTax,
      monthlyTax: round2(annualTax / 12),
    };
  }

  // ---------------------------------------------------------------- Saudi

  /**
   * GOSI contributions: Saudis pay annuities + SANED (employee 9.75%,
   * employer 11.75% incl. 2% occupational hazards); non-Saudis are covered by
   * occupational hazards only (employer 2%). The contributory wage (basic +
   * housing) is clamped to the GOSI minimum/maximum.
   */
  saudiGosi(contributoryWage: number, isSaudi: boolean): SocialInsuranceResult {
    const r = this.rules.SA;
    const wage = round2(
      Math.min(Math.max(Number(contributoryWage) || 0, r.minContributoryWage), r.maxContributoryWage),
    );
    const employeeRate = isSaudi ? r.gosiSaudiEmployeeRate : r.gosiNonSaudiEmployeeRate;
    const employerRate = isSaudi ? r.gosiSaudiEmployerRate : r.gosiNonSaudiEmployerRate;
    return {
      wage,
      employeeRate,
      employerRate,
      employee: round2(wage * employeeRate),
      employer: round2(wage * employerRate),
    };
  }

  // ---------------------------------------------------------------- payslip

  computePayslip(input: PayslipInput): PayslipResult {
    const general = this.rules.general;
    const basicFull = Number(input.basicSalary) || 0;
    const allowancesFull = (input.allowances ?? []).map((a) => ({
      ...a,
      amount: Number(a.amount) || 0,
    }));
    const fixedFull = basicFull + sum(allowancesFull.map((a) => a.amount));

    const dailyRate = fixedFull / general.daysPerMonth;
    const hourlyRate = input.dailyHours > 0 ? dailyRate / input.dailyHours : 0;

    const daysInMonth = Math.max(input.daysInMonth, 1);
    const employedDays = Math.min(Math.max(input.employedDays, 0), daysInMonth);
    const prorationFactor = employedDays / daysInMonth;

    const basic = round2(basicFull * prorationFactor);
    const allowances = allowancesFull.map((a) => ({ ...a, amount: round2(a.amount * prorationFactor) }));
    const allowancesTotal = round2(sum(allowances.map((a) => a.amount)));

    const overtimeMultiplier =
      input.country === 'EG' ? this.rules.EG.overtimeMultiplier : this.rules.SA.overtimeMultiplier;
    const overtimeHours = Math.max(Number(input.overtimeHours) || 0, 0);
    const overtimePay = round2(overtimeHours * hourlyRate * overtimeMultiplier);

    const additions = (input.additions ?? []).map((a) => ({ ...a, amount: round2(a.amount) }));
    const additionsTotal = round2(sum(additions.map((a) => a.amount)));

    const absence = round2(
      Math.max(input.absenceDays, 0) * dailyRate * general.absenceDeductionMultiplier,
    );
    const unpaidLeave = round2(Math.max(input.unpaidLeaveDays, 0) * dailyRate);
    const late = round2(
      (Math.max(input.lateMinutes, 0) / 60) * hourlyRate * general.lateDeductionMultiplier,
    );
    const earned = basic + allowancesTotal + overtimePay + additionsTotal;
    // Attendance deductions can never take the gross below zero.
    const attendanceTotal = round2(Math.min(absence + unpaidLeave + late, earned));
    const gross = round2(earned - attendanceTotal);

    // Social insurance on the contractual insurable wage (not prorated).
    let socialInsurance: SocialInsuranceResult = {
      wage: 0,
      employeeRate: 0,
      employerRate: 0,
      employee: 0,
      employer: 0,
    };
    if (input.socialInsurance.enrolled) {
      if (input.country === 'EG') {
        const wage = input.socialInsurance.insurableWage ?? fixedFull;
        socialInsurance = this.egyptSocialInsurance(wage);
      } else {
        const codes = this.rules.SA.contributoryAllowanceCodes.map((c) => c.toLowerCase());
        const wage =
          input.socialInsurance.insurableWage ??
          basicFull +
            sum(
              allowancesFull
                .filter((a) => codes.includes(String(a.code).toLowerCase()))
                .map((a) => a.amount),
            );
        socialInsurance = this.saudiGosi(wage, input.socialInsurance.isNational);
      }
    }

    let incomeTax: IncomeTaxResult = { monthlyTaxable: 0, annualTaxable: 0, annualTax: 0, monthlyTax: 0 };
    if (input.country === 'EG') {
      const nonTaxable = sum(additions.filter((a) => a.taxable === false).map((a) => a.amount));
      incomeTax = this.egyptMonthlyTax(gross - nonTaxable - socialInsurance.employee);
    }

    const otherDeductions = (input.deductions ?? []).map((d) => ({ ...d, amount: round2(d.amount) }));
    const otherDeductionsTotal = round2(sum(otherDeductions.map((d) => d.amount)));

    // Loan installments are deducted only up to the remaining net pay; the
    // rest stays pending for the next payroll.
    let available = round2(gross - socialInsurance.employee - incomeTax.monthlyTax - otherDeductionsTotal);
    const loanAllocations: LoanDue[] = [];
    let loanDue = 0;
    for (const installment of input.loanInstallments ?? []) {
      const due = round2(installment.amount);
      loanDue = round2(loanDue + due);
      const take = round2(Math.min(due, Math.max(available, 0)));
      if (take > 0) {
        loanAllocations.push({ ...installment, amount: take });
        available = round2(available - take);
      }
    }
    const loanDeduction = round2(sum(loanAllocations.map((l) => l.amount)));

    const totalDeductions = round2(
      socialInsurance.employee + incomeTax.monthlyTax + loanDeduction + otherDeductionsTotal,
    );

    return {
      country: input.country,
      dailyRate: round2(dailyRate),
      hourlyRate: round2(hourlyRate),
      prorationFactor: Math.round(prorationFactor * 10000) / 10000,
      earnings: {
        basic,
        allowances,
        allowancesTotal,
        overtimeHours,
        overtimePay,
        additions,
        additionsTotal,
      },
      attendanceDeductions: {
        absenceDays: input.absenceDays,
        absence,
        unpaidLeaveDays: input.unpaidLeaveDays,
        unpaidLeave,
        lateMinutes: input.lateMinutes,
        late,
        total: attendanceTotal,
      },
      gross,
      socialInsurance,
      incomeTax,
      loanDeduction,
      loanAllocations,
      loanShortfall: round2(loanDue - loanDeduction),
      otherDeductions,
      otherDeductionsTotal,
      totalDeductions,
      net: round2(gross - totalDeductions),
    };
  }

  // ---------------------------------------------------------------- gratuity

  /**
   * End-of-service award.
   *
   * Saudi Arabia (Labour Law art. 84): half a month's wage for each of the
   * first five years and a full month's wage for each following year, with
   * fractions of a year pro rata. Art. 85 reduces the award on resignation:
   * nothing under 2 years, one third for 2-5 years, two thirds for 5-10
   * years, full award after 10 years. Art. 87 resignations (force majeure,
   * female employee after marriage/childbirth) get the full award; art. 80
   * dismissals get nothing.
   *
   * Egypt: no statutory end-of-service gratuity for private-sector employees
   * (old-age/termination benefits are paid by the social insurance
   * authority); the result is zero unless a contractual scheme is agreed.
   */
  gratuity(input: GratuityInput): GratuityResult {
    const start = new Date(`${input.startDate}T00:00:00Z`).getTime();
    const end = new Date(`${input.endDate}T00:00:00Z`).getTime();
    const serviceDays = Math.max(Math.round((end - start) / 86400000) + 1, 0);
    const serviceYears = Math.round((serviceDays / 365) * 10000) / 10000;
    const wage = Number(input.monthlyWage) || 0;

    if (input.country === 'EG') {
      return {
        country: 'EG',
        serviceDays,
        serviceYears,
        monthlyWage: wage,
        firstFiveYearsAward: 0,
        afterFiveYearsAward: 0,
        fullAward: 0,
        entitlementFactor: 0,
        amount: 0,
        statutory: false,
        notes: [
          'End-of-service gratuity is not statutory for private-sector employees in Egypt; ' +
            'termination and old-age benefits are paid by the National Organization for Social Insurance.',
          'Any contractual or collective-agreement gratuity must be entered as a payroll addition.',
        ],
      };
    }

    const years = serviceDays / 365;
    const firstFiveYearsAward = round2(Math.min(years, 5) * wage * 0.5);
    const afterFiveYearsAward = round2(Math.max(years - 5, 0) * wage);
    const fullAward = round2(firstFiveYearsAward + afterFiveYearsAward);

    const notes: string[] = ['Saudi Labour Law article 84 (wage = last actual wage incl. regular allowances).'];
    let factor = 1;
    switch (input.reason) {
      case 'resignation':
        factor = years < 2 ? 0 : years < 5 ? 1 / 3 : years < 10 ? 2 / 3 : 1;
        notes.push('Article 85 resignation reduction applied.');
        break;
      case 'resignation_article_87':
        notes.push('Article 87: resignation for force majeure / marriage / childbirth gets the full award.');
        break;
      case 'dismissal_article_80':
        factor = 0;
        notes.push('Article 80 dismissal: no end-of-service award.');
        break;
      default:
        break;
    }

    return {
      country: 'SA',
      serviceDays,
      serviceYears,
      monthlyWage: wage,
      firstFiveYearsAward,
      afterFiveYearsAward,
      fullAward,
      entitlementFactor: Math.round(factor * 10000) / 10000,
      amount: round2(fullAward * factor),
      statutory: true,
      notes,
    };
  }
}
