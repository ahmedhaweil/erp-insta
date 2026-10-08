import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { JournalLine } from '@modules/accounting/entities/journal-line.entity';
import { Account, AccountType } from '@modules/accounting/entities/account.entity';
import { AccountingSettings } from '@modules/accounting/entities/accounting-settings.entity';
import { CostCenter } from '@modules/accounting/entities/cost-center.entity';
import { Branch } from '@modules/tenants/entities/branch.entity';
import { round, today } from '@shared/utils/document-totals.util';
import {
  BRANCH_EXPR,
  BRANCH_JOINS,
  LedgerFilter,
  SqlParams,
  ledgerWhere,
  needsBranchJoins,
} from './ledger-sql';

export interface LedgerQuery {
  from?: string;
  to?: string;
  branchId?: string;
  costCenterId?: string;
}

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  nameAr: string;
  nameEn: string;
  type: AccountType;
  level: number;
  parentId: string | null;
  isGroup: boolean;
  openingDebit: number;
  openingCredit: number;
  periodDebit: number;
  periodCredit: number;
  closingDebit: number;
  closingCredit: number;
  /** Backward-compatible aliases of the period columns. */
  debit: number;
  credit: number;
  balance: number;
}

type Sums = { debit: number; credit: number };

const r4 = (n: number) => round(n, 4);

/** Splits a signed (debit − credit) balance into debit/credit columns. */
function split(balance: number): { debit: number; credit: number } {
  const b = r4(balance);
  return { debit: b > 0 ? b : 0, credit: b < 0 ? -b : 0 };
}

/** Collects an account and all its descendants. */
export function descendantsOf(accounts: Account[], rootId: string): string[] {
  const children = new Map<string, string[]>();
  for (const a of accounts) {
    if (!a.parentId) continue;
    children.set(a.parentId, [...(children.get(a.parentId) ?? []), a.id]);
  }
  const out: string[] = [];
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    out.push(id);
    stack.push(...(children.get(id) ?? []));
  }
  return out;
}

export type CashFlowSection = 'operating' | 'investing' | 'financing';

/**
 * Cash-flow classification of a balance-sheet account (indirect method):
 * - cash and cash equivalents: excluded (they are what is explained);
 * - accumulated depreciation: non-cash adjustment in operating activities;
 * - non-current assets (code 11..): investing;
 * - non-current liabilities (code 21..) and equity: financing;
 * - every other asset/liability (receivables, inventory, VAT, payables,
 *   accruals...): working capital in operating activities.
 * The code prefixes follow the chart templates of the setup wizard.
 */
export function classifyForCashFlow(
  account: Pick<Account, 'id' | 'code' | 'type'>,
  depreciationAccountIds: Set<string>,
): { section: CashFlowSection; adjustment: boolean } {
  if (depreciationAccountIds.has(account.id)) return { section: 'operating', adjustment: true };
  if (account.type === AccountType.EQUITY) return { section: 'financing', adjustment: false };
  if (account.type === AccountType.ASSET && account.code.startsWith('11')) {
    return { section: 'investing', adjustment: false };
  }
  if (account.type === AccountType.LIABILITY && account.code.startsWith('21')) {
    return { section: 'financing', adjustment: false };
  }
  return { section: 'operating', adjustment: false };
}

/**
 * General-ledger based reports: trial balance with opening/period/closing
 * columns, general ledger / account statement with running balance, profit
 * and loss per cost center or branch, and the cash-flow statement.
 */
@Injectable()
export class LedgerReportsService {
  constructor(
    @InjectRepository(JournalLine)
    private readonly lineRepo: Repository<JournalLine>,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    @InjectRepository(AccountingSettings)
    private readonly settingsRepo: Repository<AccountingSettings>,
    @InjectRepository(CostCenter)
    private readonly costCenterRepo: Repository<CostCenter>,
    @InjectRepository(Branch)
    private readonly branchRepo: Repository<Branch>,
  ) {}

  /** Debit/credit sums of posted lines per account. */
  async sumByAccount(filter: LedgerFilter): Promise<Map<string, Sums>> {
    const p = new SqlParams();
    const where = ledgerWhere(p, filter);
    const rows: { accountId: string; debit: string; credit: string }[] = await this.lineRepo.query(
      `SELECT l.account_id AS "accountId", SUM(l.debit) AS debit, SUM(l.credit) AS credit
         FROM journal_lines l
         JOIN journal_entries e ON e.id = l.entry_id
         ${needsBranchJoins(filter) ? BRANCH_JOINS : ''}
        WHERE ${where}
        GROUP BY l.account_id`,
      p.values,
    );
    return new Map(
      rows.map((r) => [r.accountId, { debit: Number(r.debit) || 0, credit: Number(r.credit) || 0 }]),
    );
  }

  async trialBalance(
    tenantId: string,
    q: LedgerQuery & { hierarchy?: boolean; includeZero?: boolean; maxLevel?: number },
  ) {
    const accounts = await this.accountRepo.find({ where: { tenantId }, order: { code: 'ASC' } });
    const base = { tenantId, branchId: q.branchId, costCenterId: q.costCenterId };
    const opening = q.from
      ? await this.sumByAccount({ ...base, before: q.from })
      : new Map<string, Sums>();
    const period = await this.sumByAccount({ ...base, from: q.from, to: q.to });

    // own amounts per account: [opening balance, period debit, period credit]
    const own = new Map<string, [number, number, number]>();
    for (const a of accounts) {
      const o = opening.get(a.id);
      const pr = period.get(a.id);
      if (!o && !pr) continue;
      own.set(a.id, [(o?.debit ?? 0) - (o?.credit ?? 0), pr?.debit ?? 0, pr?.credit ?? 0]);
    }

    const hasChildren = new Set(accounts.filter((a) => a.parentId).map((a) => a.parentId));
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const totals = new Map<string, [number, number, number]>();
    if (q.hierarchy) {
      for (const [id, values] of own) {
        let current: Account | undefined = byId.get(id);
        const seen = new Set<string>();
        while (current && !seen.has(current.id)) {
          seen.add(current.id);
          const t = totals.get(current.id) ?? [0, 0, 0];
          totals.set(current.id, [t[0] + values[0], t[1] + values[1], t[2] + values[2]]);
          current = current.parentId ? byId.get(current.parentId) : undefined;
        }
      }
    } else {
      for (const [id, values] of own) totals.set(id, values);
    }

    const rows: TrialBalanceRow[] = [];
    for (const a of accounts) {
      const isGroup = hasChildren.has(a.id);
      if (!q.hierarchy && isGroup && !own.has(a.id)) continue;
      if (q.hierarchy && q.maxLevel !== undefined && a.level > q.maxLevel) continue;
      const values = totals.get(a.id);
      if (!values && !(q.includeZero && (q.hierarchy || a.allowPosting))) continue;
      const [ob, pd, pc] = values ?? [0, 0, 0];
      const o = split(ob);
      const c = split(ob + pd - pc);
      rows.push({
        accountId: a.id,
        code: a.code,
        nameAr: a.nameAr,
        nameEn: a.nameEn,
        type: a.type,
        level: a.level,
        parentId: a.parentId ?? null,
        isGroup,
        openingDebit: o.debit,
        openingCredit: o.credit,
        periodDebit: r4(pd),
        periodCredit: r4(pc),
        closingDebit: c.debit,
        closingCredit: c.credit,
        debit: r4(pd),
        credit: r4(pc),
        balance: r4(pd - pc),
      });
    }

    // Totals from the accounts' own amounts so groups are not double counted
    const sum = { openingDebit: 0, openingCredit: 0, periodDebit: 0, periodCredit: 0, closingDebit: 0, closingCredit: 0 };
    for (const [ob, pd, pc] of own.values()) {
      const o = split(ob);
      const c = split(ob + pd - pc);
      sum.openingDebit += o.debit;
      sum.openingCredit += o.credit;
      sum.periodDebit += pd;
      sum.periodCredit += pc;
      sum.closingDebit += c.debit;
      sum.closingCredit += c.credit;
    }
    const roundedTotals = Object.fromEntries(
      Object.entries(sum).map(([k, v]) => [k, r4(v)]),
    ) as typeof sum;

    return {
      from: q.from ?? null,
      to: q.to ?? null,
      accounts: rows,
      totals: roundedTotals,
      totalDebit: roundedTotals.periodDebit,
      totalCredit: roundedTotals.periodCredit,
    };
  }

  /**
   * General ledger / account statement of one account (or a parent account
   * with all its descendants) with opening balance and running balance.
   */
  async generalLedger(
    tenantId: string,
    q: LedgerQuery & { accountId?: string; includeChildren?: boolean },
  ) {
    if (!q.accountId) throw new BadRequestException('accountId is required');
    const account = await this.accountRepo.findOne({ where: { id: q.accountId, tenantId } });
    if (!account) throw new NotFoundException('Account not found');

    let accountIds = [account.id];
    if (q.includeChildren) {
      const all = await this.accountRepo.find({ where: { tenantId } });
      accountIds = descendantsOf(all, account.id);
    }

    const base: LedgerFilter = {
      tenantId,
      accountIds,
      branchId: q.branchId,
      costCenterId: q.costCenterId,
    };
    let openingBalance = 0;
    if (q.from) {
      for (const s of (await this.sumByAccount({ ...base, before: q.from })).values()) {
        openingBalance += s.debit - s.credit;
      }
    }
    openingBalance = r4(openingBalance);

    const p = new SqlParams();
    const where = ledgerWhere(p, { ...base, from: q.from, to: q.to });
    const rows: any[] = await this.lineRepo.query(
      `SELECT e.id AS "entryId", to_char(e.date, 'YYYY-MM-DD') AS date, e.ref_number AS "refNumber",
              e.description AS "entryDescription", l.description AS description,
              l.debit AS debit, l.credit AS credit, e.source_type AS "sourceType",
              e.source_id AS "sourceId", j.name AS journal, a.code AS "accountCode",
              a.name_ar AS "accountNameAr", a.name_en AS "accountNameEn",
              l.cost_center_id AS "costCenterId", cc.code AS "costCenterCode",
              l.branch_id AS "branchId"
         FROM journal_lines l
         JOIN journal_entries e ON e.id = l.entry_id
         JOIN accounts a ON a.id = l.account_id
         LEFT JOIN journals j ON j.id = e.journal_id
         LEFT JOIN cost_centers cc ON cc.id = l.cost_center_id
         ${needsBranchJoins(base) ? BRANCH_JOINS : ''}
        WHERE ${where}
        ORDER BY e.date ASC, e.created_at ASC, e.ref_number ASC, l.created_at ASC`,
      p.values,
    );

    let running = openingBalance;
    let totalDebit = 0;
    let totalCredit = 0;
    const entries = rows.map((r) => {
      const debit = Number(r.debit) || 0;
      const credit = Number(r.credit) || 0;
      running = r4(running + debit - credit);
      totalDebit += debit;
      totalCredit += credit;
      return {
        entryId: r.entryId,
        date: r.date as string,
        refNumber: r.refNumber,
        journal: r.journal,
        description: r.description || r.entryDescription || '',
        sourceType: r.sourceType,
        sourceId: r.sourceId,
        accountCode: r.accountCode,
        accountName: r.accountNameEn || r.accountNameAr,
        costCenterId: r.costCenterId,
        costCenterCode: r.costCenterCode,
        branchId: r.branchId,
        debit,
        credit,
        balance: running,
      };
    });

    return {
      account: {
        id: account.id,
        code: account.code,
        nameAr: account.nameAr,
        nameEn: account.nameEn || '',
        type: account.type,
      },
      accountIds,
      from: q.from ?? null,
      to: q.to ?? null,
      openingBalance,
      entries,
      totalDebit: r4(totalDebit),
      totalCredit: r4(totalCredit),
      closingBalance: r4(openingBalance + totalDebit - totalCredit),
    };
  }

  /** Profit and loss per cost center or per branch (unassigned lines grouped apart). */
  async profitAndLossBy(dimension: 'cost_center' | 'branch', tenantId: string, q: LedgerQuery) {
    const filter: LedgerFilter = {
      tenantId,
      from: q.from,
      to: q.to,
      branchId: q.branchId,
      costCenterId: q.costCenterId,
      excludeClosing: true,
    };
    const p = new SqlParams();
    const where = ledgerWhere(p, filter);
    const dimExpr = dimension === 'branch' ? BRANCH_EXPR : 'l.cost_center_id';
    const rows: { dimensionId: string | null; accountId: string; debit: string; credit: string }[] =
      await this.lineRepo.query(
        `SELECT ${dimExpr} AS "dimensionId", l.account_id AS "accountId",
                SUM(l.debit) AS debit, SUM(l.credit) AS credit
           FROM journal_lines l
           JOIN journal_entries e ON e.id = l.entry_id
           JOIN accounts a ON a.id = l.account_id
           ${needsBranchJoins(filter, dimension === 'branch') ? BRANCH_JOINS : ''}
          WHERE ${where} AND a.type IN ('revenue', 'expense')
          GROUP BY 1, 2`,
        p.values,
      );

    const accountIds = [...new Set(rows.map((r) => r.accountId))];
    const accounts = accountIds.length
      ? await this.accountRepo.find({ where: { tenantId, id: In(accountIds) } })
      : [];
    const accountById = new Map(accounts.map((a) => [a.id, a]));

    const dimIds = [...new Set(rows.map((r) => r.dimensionId).filter((x): x is string => !!x))];
    const names = new Map<string, { code: string; name: string }>();
    if (dimIds.length && dimension === 'cost_center') {
      for (const c of await this.costCenterRepo.find({ where: { tenantId, id: In(dimIds) } })) {
        names.set(c.id, { code: c.code, name: c.nameEn || c.nameAr });
      }
    } else if (dimIds.length) {
      for (const b of await this.branchRepo.find({ where: { tenantId, id: In(dimIds) } })) {
        names.set(b.id, { code: b.code, name: b.name });
      }
    }

    type Group = {
      id: string | null;
      code: string | null;
      name: string;
      revenue: number;
      expenses: number;
      netProfit: number;
      margin: number | null;
      accounts: { accountId: string; code: string; name: string; type: AccountType; amount: number }[];
    };
    const groups = new Map<string, Group>();
    for (const r of rows) {
      const account = accountById.get(r.accountId);
      if (!account) continue;
      const key = r.dimensionId ?? '';
      const meta = r.dimensionId ? names.get(r.dimensionId) : undefined;
      const group =
        groups.get(key) ??
        ({
          id: r.dimensionId,
          code: meta?.code ?? null,
          name: r.dimensionId ? meta?.name ?? r.dimensionId : 'Unassigned',
          revenue: 0,
          expenses: 0,
          netProfit: 0,
          margin: null,
          accounts: [],
        } as Group);
      const net = Number(r.debit) - Number(r.credit);
      const amount = r4(account.type === AccountType.REVENUE ? -net : net);
      if (account.type === AccountType.REVENUE) group.revenue = r4(group.revenue + amount);
      else group.expenses = r4(group.expenses + amount);
      group.accounts.push({
        accountId: account.id,
        code: account.code,
        name: account.nameEn || account.nameAr,
        type: account.type,
        amount,
      });
      groups.set(key, group);
    }

    const list = [...groups.values()].map((g) => {
      g.netProfit = r4(g.revenue - g.expenses);
      g.margin = g.revenue ? round((g.netProfit / g.revenue) * 100, 2) : null;
      g.accounts.sort((a, b) => a.code.localeCompare(b.code));
      return g;
    });
    list.sort((a, b) => (a.id === null ? 1 : b.id === null ? -1 : (a.code ?? '').localeCompare(b.code ?? '')));

    const totalRevenue = r4(list.reduce((s, g) => s + g.revenue, 0));
    const totalExpenses = r4(list.reduce((s, g) => s + g.expenses, 0));
    return {
      dimension,
      from: q.from ?? null,
      to: q.to ?? null,
      groups: list,
      totalRevenue,
      totalExpenses,
      netProfit: r4(totalRevenue - totalExpenses),
    };
  }

  /**
   * Cash-flow statement, indirect method: net profit of the period adjusted by
   * the movement of every non-cash balance-sheet account, classified with
   * {@link classifyForCashFlow}. Cash accounts are the default cash and bank
   * accounts of the accounting settings and their sibling postable accounts.
   * Year-end closing entries are ignored (they only move P&L to equity).
   */
  async cashFlow(tenantId: string, q: { from?: string; to?: string }) {
    const to = q.to ?? today();
    const from = q.from ?? `${to.slice(0, 4)}-01-01`;
    const settings = await this.settingsRepo.findOne({ where: { tenantId } });
    if (!settings?.cashAccountId && !settings?.bankAccountId) {
      throw new BadRequestException(
        'Configure the default cash and bank accounts (accounting settings) to compute the cash flow',
      );
    }
    const accounts = await this.accountRepo.find({ where: { tenantId } });
    const byId = new Map(accounts.map((a) => [a.id, a]));

    const cashParents = new Set(
      [settings.cashAccountId, settings.bankAccountId]
        .map((id) => (id ? byId.get(id)?.parentId : undefined))
        .filter((x): x is string => !!x),
    );
    const cashIds = new Set(
      accounts
        .filter(
          (a) =>
            a.id === settings.cashAccountId ||
            a.id === settings.bankAccountId ||
            (a.type === AccountType.ASSET && a.allowPosting && a.parentId && cashParents.has(a.parentId)),
        )
        .map((a) => a.id),
    );
    const depreciationIds = new Set(
      [settings.accumulatedDepreciationAccountId].filter((x): x is string => !!x),
    );

    const opening = await this.sumByAccount({ tenantId, before: from });
    const movements = await this.sumByAccount({ tenantId, from, to, excludeClosing: true });

    let openingCash = 0;
    for (const id of cashIds) {
      const s = opening.get(id);
      if (s) openingCash += s.debit - s.credit;
    }

    let netProfit = 0;
    let cashMovement = 0;
    type Line = { accountId: string; code: string; name: string; amount: number };
    const sections: Record<CashFlowSection, { adjustments: Line[]; lines: Line[]; total: number }> = {
      operating: { adjustments: [], lines: [], total: 0 },
      investing: { adjustments: [], lines: [], total: 0 },
      financing: { adjustments: [], lines: [], total: 0 },
    };

    for (const [accountId, s] of movements) {
      const account = byId.get(accountId);
      if (!account) continue;
      const delta = s.debit - s.credit;
      if (cashIds.has(accountId)) {
        cashMovement += delta;
        continue;
      }
      if (account.type === AccountType.REVENUE || account.type === AccountType.EXPENSE) {
        netProfit -= delta;
        continue;
      }
      const effect = r4(-delta);
      if (effect === 0) continue;
      const { section, adjustment } = classifyForCashFlow(account, depreciationIds);
      const line = { accountId, code: account.code, name: account.nameEn || account.nameAr, amount: effect };
      (adjustment ? sections[section].adjustments : sections[section].lines).push(line);
    }

    netProfit = r4(netProfit);
    for (const key of Object.keys(sections) as CashFlowSection[]) {
      const sec = sections[key];
      sec.adjustments.sort((a, b) => a.code.localeCompare(b.code));
      sec.lines.sort((a, b) => a.code.localeCompare(b.code));
      sec.total = r4(
        (key === 'operating' ? netProfit : 0) +
          [...sec.adjustments, ...sec.lines].reduce((sum, l) => sum + l.amount, 0),
      );
    }

    const netChange = r4(sections.operating.total + sections.investing.total + sections.financing.total);
    openingCash = r4(openingCash);
    const closingCash = r4(openingCash + netChange);
    const closingCashPerLedger = r4(openingCash + cashMovement);
    return {
      from,
      to,
      method: 'indirect',
      cashAccountIds: [...cashIds],
      netProfit,
      operating: sections.operating,
      investing: sections.investing,
      financing: sections.financing,
      netChange,
      openingCash,
      closingCash,
      closingCashPerLedger,
      difference: r4(closingCash - closingCashPerLedger),
    };
  }
}
