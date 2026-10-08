import { BadRequestException } from '@nestjs/common';
import { AccountType } from '@modules/accounting/entities/account.entity';
import { LedgerReportsService, classifyForCashFlow, descendantsOf } from './ledger-reports.service';
import { BRANCH_EXPR, SqlParams, ledgerWhere } from './ledger-sql';

const acc = (id: string, code: string, type: AccountType, parentId: string | null, level: number, allowPosting = true) =>
  ({ id, code, nameAr: code, nameEn: code, type, parentId, level, allowPosting }) as any;

// 1 Assets > 12 Current > 1204 Cash group > 120401 cash, 120403 bank; 1201 > 120201 receivable
const ACCOUNTS = [
  acc('a1', '1', AccountType.ASSET, null, 0, false),
  acc('a11', '11', AccountType.ASSET, 'a1', 1, false),
  acc('a1101', '110101', AccountType.ASSET, 'a11', 3),
  acc('a1102', '110201', AccountType.ASSET, 'a11', 3),
  acc('a12', '12', AccountType.ASSET, 'a1', 1, false),
  acc('a1204', '1204', AccountType.ASSET, 'a12', 2, false),
  acc('cash', '120401', AccountType.ASSET, 'a1204', 3),
  acc('bank', '120403', AccountType.ASSET, 'a1204', 3),
  acc('recv', '120201', AccountType.ASSET, 'a12', 3),
  acc('loan', '210101', AccountType.LIABILITY, null, 3),
  acc('pay', '220101', AccountType.LIABILITY, null, 3),
  acc('cap', '310101', AccountType.EQUITY, null, 3),
  acc('sales', '410101', AccountType.REVENUE, null, 3),
  acc('exp', '520101', AccountType.EXPENSE, null, 3),
];

describe('ledger-sql', () => {
  it('builds parameterised filters, with branch resolution only when asked', () => {
    const p = new SqlParams();
    const where = ledgerWhere(p, {
      tenantId: 't1',
      from: '2026-01-01',
      before: '2026-02-01',
      costCenterId: 'cc',
      branchId: 'br',
      accountIds: ['a'],
      excludeClosing: true,
    });
    expect(where).toContain('e.tenant_id = $1');
    expect(where).toContain('e.date >= $2');
    expect(where).toContain('e.date < $3');
    expect(where).toContain('l.cost_center_id = $4');
    expect(where).toContain(`${BRANCH_EXPR} = $5`);
    expect(where).toContain('ANY($6::uuid[])');
    expect(where).toContain("'fiscal_year_closing'");
    expect(p.values).toEqual(['t1', '2026-01-01', '2026-02-01', 'cc', 'br', ['a']]);
  });
});

describe('cash-flow helpers', () => {
  it('classifies balance-sheet accounts', () => {
    const dep = new Set(['a1102']);
    expect(classifyForCashFlow(ACCOUNTS[3], dep)).toEqual({ section: 'operating', adjustment: true });
    expect(classifyForCashFlow(ACCOUNTS[2], dep).section).toBe('investing');
    expect(classifyForCashFlow(ACCOUNTS[8], dep)).toEqual({ section: 'operating', adjustment: false });
    expect(classifyForCashFlow(ACCOUNTS[9], dep).section).toBe('financing');
    expect(classifyForCashFlow(ACCOUNTS[10], dep).section).toBe('operating');
    expect(classifyForCashFlow(ACCOUNTS[11], dep).section).toBe('financing');
  });

  it('collects descendants', () => {
    expect(descendantsOf(ACCOUNTS, 'a12').sort()).toEqual(['a12', 'a1204', 'bank', 'cash', 'recv'].sort());
  });
});

describe('LedgerReportsService', () => {
  let service: LedgerReportsService;
  let query: jest.Mock;
  let accountRepo: Record<string, jest.Mock>;
  let settingsRepo: Record<string, jest.Mock>;

  beforeEach(() => {
    query = jest.fn();
    accountRepo = {
      find: jest.fn().mockResolvedValue(ACCOUNTS),
      findOne: jest.fn(async ({ where }) => ACCOUNTS.find((a) => a.id === where.id) ?? null),
    };
    settingsRepo = {
      findOne: jest.fn().mockResolvedValue({
        cashAccountId: 'cash',
        bankAccountId: 'bank',
        accumulatedDepreciationAccountId: 'a1102',
      }),
    };
    service = new LedgerReportsService(
      { query } as any,
      accountRepo as any,
      settingsRepo as any,
      { find: jest.fn().mockResolvedValue([]) } as any,
      { find: jest.fn().mockResolvedValue([]) } as any,
    );
  });

  const sums = (rows: [string, number, number][]) =>
    rows.map(([accountId, debit, credit]) => ({ accountId, debit: String(debit), credit: String(credit) }));

  it('computes opening, period and closing columns and balanced totals', async () => {
    query
      .mockResolvedValueOnce(sums([['cash', 1000, 0], ['cap', 0, 1000]])) // opening
      .mockResolvedValueOnce(sums([['cash', 500, 200], ['sales', 0, 500], ['exp', 200, 0]])); // period

    const tb = await service.trialBalance('t1', { from: '2026-02-01', to: '2026-02-28' });
    const cash = tb.accounts.find((a) => a.accountId === 'cash')!;
    expect(cash).toMatchObject({
      openingDebit: 1000,
      openingCredit: 0,
      periodDebit: 500,
      periodCredit: 200,
      closingDebit: 1300,
      closingCredit: 0,
      balance: 300,
    });
    expect(tb.accounts.some((a) => a.isGroup)).toBe(false);
    expect(tb.totals.openingDebit).toBe(tb.totals.openingCredit);
    expect(tb.totals.periodDebit).toBe(tb.totals.periodCredit);
    expect(tb.totals.closingDebit).toBe(tb.totals.closingCredit);
    expect(tb.totalDebit).toBe(700);
  });

  it('rolls balances up to parent accounts in hierarchy mode', async () => {
    query
      .mockResolvedValueOnce(sums([]))
      .mockResolvedValueOnce(sums([['cash', 100, 0], ['bank', 50, 0], ['recv', 30, 0], ['sales', 0, 180]]));
    const tb = await service.trialBalance('t1', { from: '2026-01-01', hierarchy: true, maxLevel: 1 });
    const byCode = new Map(tb.accounts.map((a) => [a.code, a]));
    expect(byCode.get('1')!.closingDebit).toBe(180);
    expect(byCode.get('12')!.periodDebit).toBe(180);
    expect(byCode.has('1204')).toBe(false); // deeper than maxLevel
    expect(byCode.get('1')!.isGroup).toBe(true);
    // totals are not double counted by the group rows
    expect(tb.totals.periodDebit).toBe(180);
  });

  it('starts the general ledger from the opening balance and runs the balance', async () => {
    query
      .mockResolvedValueOnce(sums([['cash', 300, 100]]))
      .mockResolvedValueOnce([
        { date: '2026-02-01', refNumber: 'JE-1', debit: '50', credit: '0' },
        { date: '2026-02-02', refNumber: 'JE-2', debit: '0', credit: '20' },
      ]);
    const gl = await service.generalLedger('t1', { accountId: 'cash', from: '2026-02-01' });
    expect(gl.openingBalance).toBe(200);
    expect(gl.entries.map((e) => e.balance)).toEqual([250, 230]);
    expect(gl.closingBalance).toBe(230);
    expect(gl.totalDebit).toBe(50);
  });

  it('includes descendants for an account statement of a parent account', async () => {
    query.mockResolvedValueOnce([]);
    const gl = await service.generalLedger('t1', { accountId: 'a1204', includeChildren: true });
    expect(gl.accountIds.sort()).toEqual(['a1204', 'bank', 'cash']);
    expect(query.mock.calls[0][1]).toContainEqual(gl.accountIds);
  });

  it('requires an account for the general ledger', async () => {
    await expect(service.generalLedger('t1', {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('builds an indirect cash flow that reconciles with the cash accounts', async () => {
    query
      .mockResolvedValueOnce(sums([['cash', 1000, 0], ['cap', 0, 1000]])) // opening
      .mockResolvedValueOnce(
        sums([
          // sale on credit 500, collection 300, expense paid 100 by bank, asset bought 400 cash,
          // depreciation 50, loan received 1000 in bank
          ['sales', 0, 500],
          ['recv', 500, 300],
          ['cash', 300, 400],
          ['exp', 150, 0],
          ['bank', 1000, 100],
          ['a1101', 400, 0],
          ['a1102', 0, 50],
          ['loan', 0, 1000],
        ]),
      );
    const cf = await service.cashFlow('t1', { from: '2026-01-01', to: '2026-12-31' });
    expect(cf.netProfit).toBe(350);
    expect(cf.operating.adjustments).toEqual([expect.objectContaining({ code: '110201', amount: 50 })]);
    expect(cf.operating.lines).toEqual([expect.objectContaining({ code: '120201', amount: -200 })]);
    expect(cf.operating.total).toBe(200);
    expect(cf.investing.total).toBe(-400);
    expect(cf.financing.total).toBe(1000);
    expect(cf.netChange).toBe(800);
    expect(cf.openingCash).toBe(1000);
    expect(cf.closingCash).toBe(1800);
    expect(cf.difference).toBe(0);
  });

  it('refuses the cash flow without default cash/bank accounts', async () => {
    settingsRepo.findOne.mockResolvedValue(null);
    await expect(service.cashFlow('t1', {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('splits profit and loss per cost center with an unassigned group', async () => {
    query.mockResolvedValueOnce([
      { dimensionId: null, accountId: 'sales', debit: '0', credit: '100' },
      { dimensionId: 'cc1', accountId: 'sales', debit: '0', credit: '300' },
      { dimensionId: 'cc1', accountId: 'exp', debit: '120', credit: '0' },
    ]);
    accountRepo.find.mockResolvedValue(ACCOUNTS.filter((a) => a.id === 'sales' || a.id === 'exp'));
    const r = await service.profitAndLossBy('cost_center', 't1', {});
    expect(r.groups[0]).toMatchObject({ id: 'cc1', revenue: 300, expenses: 120, netProfit: 180, margin: 60 });
    expect(r.groups[1]).toMatchObject({ id: null, name: 'Unassigned', revenue: 100 });
    expect(r.netProfit).toBe(280);
    expect(query.mock.calls[0][0]).not.toContain('br_si');
  });
});
