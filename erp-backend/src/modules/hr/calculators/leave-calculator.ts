/**
 * Pure leave-balance engine: yearly entitlement (senior entitlement,
 * proration for joiners), monthly accrual, carry-forward with a cap and an
 * expiry date, encashment and the resulting balance of a year.
 */

export type LeaveAccrualMethod = 'annual' | 'monthly';

export interface LeavePolicy {
  annualEntitlement: number;
  seniorEntitlement?: number | null;
  seniorAfterYears?: number | null;
  /** annual = full entitlement on 1 January; monthly = earned month by month. */
  accrualMethod?: LeaveAccrualMethod;
  carryForward?: boolean;
  /** Maximum days carried into the next year; null = unlimited. */
  carryForwardMax?: number | null;
  /**
   * Carried days must be used within this many months of the new year (3 =
   * by 31 March); unused carried days then expire. null = never expire.
   */
  carryForwardExpiryMonths?: number | null;
}

/** One day (or half day) of approved leave consumed from the balance. */
export interface LeaveUsage {
  date: string;
  days: number;
}

export interface LeaveEncashmentUsage {
  year: number;
  days: number;
}

export interface LeaveLedgerInput {
  policy: LeavePolicy;
  hireDate: string;
  year: number;
  /** Balance date (accrual and expiry are evaluated at this date). */
  asOf: string;
  taken: LeaveUsage[];
  pending?: LeaveUsage[];
  encashed?: LeaveEncashmentUsage[];
}

export interface LeaveYearLedger {
  year: number;
  /** Full entitlement of the year (prorated for joiners). */
  entitlement: number;
  /** Part of the entitlement earned at `asOf` (equals entitlement for annual accrual). */
  accrued: number;
  carriedIn: number;
  /** Carried days consumed by leave taken before the expiry date. */
  carriedUsed: number;
  carriedExpired: number;
  taken: number;
  pending: number;
  encashed: number;
  remaining: number;
  /** Days that will carry into the next year (cap applied), on the year-end balance. */
  carryOut: number;
  carryExpiryDate: string | null;
}

const r2 = (v: number) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const DAY = 86400000;

function daysBetweenInclusive(from: string, to: string): number {
  if (to < from) return 0;
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY) + 1;
}

export function lastDayOfMonth(year: number, month: number): string {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(days).padStart(2, '0')}`;
}

/** Last day of the last fully elapsed month at `date` (the date itself when it is a month end). */
export function lastCompletedMonthEnd(date: string): string {
  const [y, m] = date.split('-').map(Number);
  const end = lastDayOfMonth(y, m);
  if (date >= end) return end;
  return m === 1 ? `${y - 1}-12-31` : lastDayOfMonth(y, m - 1);
}

/** Entitlement before proration: the senior entitlement once the service years are reached by year end. */
export function baseEntitlement(policy: LeavePolicy, hireDate: string, year: number): number {
  const base = Number(policy.annualEntitlement) || 0;
  if (base <= 0) return 0;
  const yearEnd = `${year}-12-31`;
  if (policy.seniorEntitlement != null && policy.seniorAfterYears != null) {
    const serviceYears =
      (Date.parse(`${yearEnd}T00:00:00Z`) - Date.parse(`${hireDate}T00:00:00Z`)) / (365.25 * DAY);
    if (serviceYears >= policy.seniorAfterYears) return Number(policy.seniorEntitlement);
  }
  return base;
}

/** Entitlement of a year, prorated by the days employed for joiners. */
export function yearEntitlement(policy: LeavePolicy, hireDate: string, year: number): number {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  if (hireDate > yearEnd) return 0;
  let entitlement = baseEntitlement(policy, hireDate, year);
  if (entitlement <= 0) return 0;
  if (hireDate > yearStart) {
    entitlement =
      (entitlement * daysBetweenInclusive(hireDate, yearEnd)) / daysBetweenInclusive(yearStart, yearEnd);
  }
  return r2(entitlement);
}

/**
 * Entitlement earned at `asOf`. Monthly accrual credits the entitlement at
 * each month end, pro rata to the days employed in the year so far.
 */
export function accruedEntitlement(
  policy: LeavePolicy,
  hireDate: string,
  year: number,
  asOf: string,
): number {
  const full = yearEntitlement(policy, hireDate, year);
  if (policy.accrualMethod !== 'monthly' || full <= 0) return full;
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const cutoff = lastCompletedMonthEnd(asOf);
  const end = cutoff < yearEnd ? cutoff : yearEnd;
  const start = hireDate > yearStart ? hireDate : yearStart;
  if (end < start) return 0;
  const base = baseEntitlement(policy, hireDate, year);
  return r2(Math.min((base * daysBetweenInclusive(start, end)) / daysBetweenInclusive(yearStart, yearEnd), full));
}

export function carryExpiryDate(policy: LeavePolicy, year: number): string | null {
  const months = policy.carryForwardExpiryMonths;
  if (!policy.carryForward || months == null || months <= 0) return null;
  const capped = Math.min(Math.round(months), 12);
  return lastDayOfMonth(year, capped);
}

/**
 * Balance of one leave type for `year`, rolling the carry-forward from the
 * hire year. Leave taken before the carry expiry date consumes carried days
 * first; carried days still unused at the expiry date are forfeited.
 */
export function leaveLedger(input: LeaveLedgerInput): LeaveYearLedger {
  const { policy, hireDate, year, asOf } = input;
  const hireYear = Number(hireDate.slice(0, 4));
  const firstYear = policy.carryForward ? Math.min(hireYear, year) : year;
  const sumIn = (items: LeaveUsage[] | undefined, y: number, until?: string) =>
    r2(
      (items ?? [])
        .filter((u) => u.date.startsWith(`${y}-`) && (!until || u.date <= until))
        .reduce((s, u) => s + Number(u.days), 0),
    );

  let carriedIn = 0;
  let ledger: LeaveYearLedger | null = null;
  for (let y = firstYear; y <= year; y++) {
    const current = y === year;
    const at = current ? asOf : `${y}-12-31`;
    const entitlement = y < hireYear ? 0 : yearEntitlement(policy, hireDate, y);
    const accrued = y < hireYear ? 0 : accruedEntitlement(policy, hireDate, y, current ? asOf : `${y}-12-31`);
    const taken = sumIn(input.taken, y);
    const encashed = r2(
      (input.encashed ?? []).filter((e) => e.year === y).reduce((s, e) => s + Number(e.days), 0),
    );
    const expiry = carryExpiryDate(policy, y);
    const takenBeforeExpiry = expiry ? sumIn(input.taken, y, expiry) : taken;
    const carriedUsed = r2(Math.min(carriedIn, takenBeforeExpiry));
    const carriedExpired = expiry && at > expiry ? r2(carriedIn - carriedUsed) : 0;
    const remaining = r2(carriedIn + accrued - taken - encashed - carriedExpired);

    // Carry into next year from the year-end position (full entitlement,
    // carried days expired by then).
    const yearEndExpired = expiry ? r2(carriedIn - carriedUsed) : 0;
    const yearEndRemaining = r2(carriedIn + entitlement - taken - encashed - yearEndExpired);
    let carryOut = 0;
    if (policy.carryForward && yearEndRemaining > 0) {
      const cap = policy.carryForwardMax;
      carryOut = cap == null ? yearEndRemaining : r2(Math.min(yearEndRemaining, Math.max(Number(cap), 0)));
    }

    ledger = {
      year: y,
      entitlement,
      accrued,
      carriedIn,
      carriedUsed,
      carriedExpired,
      taken,
      pending: sumIn(input.pending, y),
      encashed,
      remaining,
      carryOut,
      carryExpiryDate: expiry,
    };
    carriedIn = carryOut;
  }
  return ledger as LeaveYearLedger;
}
