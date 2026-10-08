/**
 * Statutory payroll parameters (social insurance and salary tax) for the
 * countries the ERP supports. The defaults below reflect the rules in force
 * for 2025; most of them change every year (Egypt updates the minimum and
 * maximum insurable wage each January, Saudi GOSI rates are being phased in
 * for new entrants), so every value can be overridden per tenant through
 * the HR settings (`PUT /hr/settings`) without a code change.
 */

export interface TaxBracket {
  /** Upper bound of the bracket in annual taxable income; null = unbounded. */
  upTo: number | null;
  /** Rate as a fraction (0.1 = 10%). */
  rate: number;
}

/**
 * Egyptian high-income rule: above `above` annual taxable income the
 * brackets before `startBracket` are not granted; the income up to the upper
 * bound of `startBracket` is taxed at that bracket's rate.
 */
export interface HighIncomeTier {
  above: number;
  startBracket: number;
}

export interface EgyptRules {
  /** Employee share of social insurance (Law 148/2019). */
  siEmployeeRate: number;
  /** Employer share of social insurance (Law 148/2019). */
  siEmployerRate: number;
  /** Monthly minimum insurable wage (EGP). 2025: 2,300. */
  minInsurableWage: number;
  /** Monthly maximum insurable wage (EGP). 2025: 14,500. */
  maxInsurableWage: number;
  /** Annual personal exemption (Law 7/2024: 20,000 EGP). */
  personalExemption: number;
  /** Annual salary tax brackets (Law 7/2024). */
  taxBrackets: TaxBracket[];
  /** Bracket-removal tiers for high incomes (Law 7/2024). */
  highIncomeTiers: HighIncomeTier[];
  /** Overtime premium multiplier on the hourly wage. */
  overtimeMultiplier: number;
  /**
   * Martyrs, victims and missing persons fund (Law 4/2021): 0.05% of the
   * gross salary, borne by the employee (deducted) or the employer.
   */
  martyrsFund: MartyrsFundRules;
  /**
   * Contractual end-of-service award in months of wage per service year
   * (Egypt has no statutory private-sector gratuity; 0 = none).
   */
  contractualGratuityMonthsPerYear: number;
}

export interface MartyrsFundRules {
  enabled: boolean;
  /** Fraction of the gross salary (0.0005 = 0.05%). */
  rate: number;
  bearer: 'employee' | 'employer';
}

export type OvertimeMode = 'auto' | 'approved_only';

export interface SaudiRules {
  /** GOSI employee share for Saudi nationals (annuities 9% + SANED 0.75%). */
  gosiSaudiEmployeeRate: number;
  /** GOSI employer share for Saudi nationals (annuities 9% + SANED 0.75% + hazards 2%). */
  gosiSaudiEmployerRate: number;
  /** GOSI employee share for non-Saudis (none). */
  gosiNonSaudiEmployeeRate: number;
  /** GOSI employer share for non-Saudis (occupational hazards 2%). */
  gosiNonSaudiEmployerRate: number;
  /** Minimum monthly contributory wage (SAR). */
  minContributoryWage: number;
  /** Maximum monthly contributory wage (SAR). */
  maxContributoryWage: number;
  /** Allowance codes included in the GOSI wage with the basic salary. */
  contributoryAllowanceCodes: string[];
  /** Overtime premium multiplier on the hourly wage (Labour Law art. 107). */
  overtimeMultiplier: number;
}

export interface GeneralRules {
  /** Days used to derive the daily wage from the monthly wage. */
  daysPerMonth: number;
  /** Multiplier applied to the daily wage for each absence day. */
  absenceDeductionMultiplier: number;
  /** Multiplier applied to the hourly wage for late minutes; 0 disables. */
  lateDeductionMultiplier: number;
  /**
   * Overtime source: `auto` = hours computed from attendance plus approved
   * overtime requests; `approved_only` = approved overtime requests only
   * (capped at the attendance overtime of that day for tracked employees).
   */
  overtimeMode: OvertimeMode;
}

export interface PayrollRules {
  general: GeneralRules;
  EG: EgyptRules;
  SA: SaudiRules;
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<infer _U> ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export const DEFAULT_PAYROLL_RULES: PayrollRules = {
  general: {
    daysPerMonth: 30,
    absenceDeductionMultiplier: 1,
    lateDeductionMultiplier: 1,
    overtimeMode: 'auto',
  },
  EG: {
    siEmployeeRate: 0.11,
    siEmployerRate: 0.1875,
    minInsurableWage: 2300,
    maxInsurableWage: 14500,
    personalExemption: 20000,
    taxBrackets: [
      { upTo: 40000, rate: 0 },
      { upTo: 55000, rate: 0.1 },
      { upTo: 70000, rate: 0.15 },
      { upTo: 200000, rate: 0.2 },
      { upTo: 400000, rate: 0.225 },
      { upTo: 1200000, rate: 0.25 },
      { upTo: null, rate: 0.275 },
    ],
    highIncomeTiers: [
      { above: 600000, startBracket: 1 },
      { above: 700000, startBracket: 2 },
      { above: 800000, startBracket: 3 },
      { above: 900000, startBracket: 4 },
      { above: 1200000, startBracket: 5 },
    ],
    overtimeMultiplier: 1.35,
    martyrsFund: { enabled: false, rate: 0.0005, bearer: 'employee' },
    contractualGratuityMonthsPerYear: 0,
  },
  SA: {
    gosiSaudiEmployeeRate: 0.0975,
    gosiSaudiEmployerRate: 0.1175,
    gosiNonSaudiEmployeeRate: 0,
    gosiNonSaudiEmployerRate: 0.02,
    minContributoryWage: 1500,
    maxContributoryWage: 45000,
    contributoryAllowanceCodes: ['housing'],
    overtimeMultiplier: 1.5,
  },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep-merges tenant overrides into the defaults (arrays are replaced). */
export function mergeRules(overrides?: DeepPartial<PayrollRules> | null): PayrollRules {
  const merge = (base: any, patch: any): any => {
    if (!isPlainObject(patch)) return base;
    const out: any = Array.isArray(base) ? [...base] : { ...base };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === null) continue;
      out[key] = isPlainObject(value) && isPlainObject(base?.[key]) ? merge(base[key], value) : value;
    }
    return out;
  };
  return merge(DEFAULT_PAYROLL_RULES, overrides ?? {});
}
