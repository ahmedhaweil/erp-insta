import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Treasury } from '../entities/treasury.entity';

/**
 * Treasury access rules shared by the treasury module and the payments
 * module (which cannot import the treasury services: treasury imports
 * payments). Pure functions plus a small helper taking its dependencies.
 */

/** Holders of this permission may use every treasury. */
export const TREASURY_ALL_PERMISSION = { module: 'treasury', screen: 'treasuries', action: 'all' };

export interface PermissionChecker {
  hasPermission(
    tenantId: string,
    userId: string,
    requirement: { module: string; screen?: string; action?: string },
  ): Promise<boolean>;
}

type TreasuryLike = Pick<Treasury, 'code' | 'type'> &
  Partial<Pick<Treasury, 'custodianUserId' | 'custodianUserIds' | 'allowNegative' | 'currencyId' | 'accountId'>>;

/** Custodians of a treasury; none means the treasury is not restricted. */
export function custodiansOf(treasury: TreasuryLike): string[] {
  return [
    ...new Set([treasury.custodianUserId, ...(treasury.custodianUserIds ?? [])].filter(Boolean) as string[]),
  ];
}

export function isRestricted(treasury: TreasuryLike): boolean {
  return custodiansOf(treasury).length > 0;
}

export function canUseTreasury(treasury: TreasuryLike, userId: string, hasAllPermission: boolean): boolean {
  if (hasAllPermission) return true;
  const custodians = custodiansOf(treasury);
  return !custodians.length || custodians.includes(userId);
}

/** Cash boxes cannot go negative unless allowed; bank accounts can (overdraft) unless forbidden. */
export function treasuryAllowsNegative(treasury: TreasuryLike): boolean {
  if (treasury.allowNegative === true || treasury.allowNegative === false) return treasury.allowNegative;
  return treasury.type === 'bank';
}

/** Throws when paying `outflow` out of `balance` would take the treasury below zero. */
export function assertSufficientFunds(treasury: TreasuryLike, balance: number, outflow: number): void {
  if (!(outflow > 0) || treasuryAllowsNegative(treasury)) return;
  const after = Math.round((Number(balance) - Number(outflow)) * 10000) / 10000;
  if (after < -0.005) {
    throw new BadRequestException(
      `Treasury ${treasury.code} balance ${Number(balance).toFixed(2)} is not enough for ${Number(outflow).toFixed(2)}; it cannot go negative`,
    );
  }
}

/** SQL balance of a treasury (in its currency) as of a date and overall. */
export async function queryTreasuryBalance(
  query: (sql: string, params: any[]) => Promise<any[]>,
  tenantId: string,
  treasury: { accountId: string; currencyId?: string | null },
  asOf?: string,
): Promise<number> {
  const amount = treasury.currencyId
    ? `COALESCE(jl.amount_currency, (jl.debit - jl.credit) / NULLIF(je.exchange_rate, 0))`
    : `(jl.debit - jl.credit)`;
  const params: any[] = [tenantId, treasury.accountId];
  let where = `je.tenant_id = $1 AND jl.account_id = $2 AND je.status = 'posted'`;
  if (asOf) {
    params.push(asOf);
    where += ` AND je.date <= $3`;
  }
  const [row] = await query(
    `SELECT COALESCE(SUM(${amount}), 0) AS balance
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
      WHERE ${where}`,
    params,
  );
  return Math.round(Number(row?.balance ?? 0) * 10000) / 10000;
}

/**
 * Enforces custodianship and the no-negative rule for a document using a
 * treasury. `outflow` (treasury currency) is the money leaving it.
 */
export async function enforceTreasuryRules(deps: {
  tenantId: string;
  userId: string;
  treasury: TreasuryLike & Pick<Treasury, 'accountId'>;
  rbac?: PermissionChecker | null;
  query?: (sql: string, params: any[]) => Promise<any[]>;
  outflow?: number;
  date?: string;
}): Promise<void> {
  const { tenantId, userId, treasury } = deps;
  if (isRestricted(treasury) && !custodiansOf(treasury).includes(userId)) {
    const all = deps.rbac ? await deps.rbac.hasPermission(tenantId, userId, TREASURY_ALL_PERMISSION) : false;
    if (!canUseTreasury(treasury, userId, all)) {
      throw new ForbiddenException(`You are not a custodian of treasury ${treasury.code}`);
    }
  }
  const outflow = Number(deps.outflow ?? 0);
  if (outflow > 0 && deps.query && !treasuryAllowsNegative(treasury)) {
    // Both today's balance and the balance at the document date must cover it.
    const total = await queryTreasuryBalance(deps.query, tenantId, treasury);
    assertSufficientFunds(treasury, total, outflow);
    if (deps.date) {
      const atDate = await queryTreasuryBalance(deps.query, tenantId, treasury, deps.date);
      assertSufficientFunds(treasury, atDate, outflow);
    }
  }
}
