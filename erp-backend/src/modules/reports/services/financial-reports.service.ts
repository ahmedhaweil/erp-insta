import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JournalLine } from '@modules/accounting/entities/journal-line.entity';
import { JournalEntry, JournalEntryStatus } from '@modules/accounting/entities/journal-entry.entity';
import { Account, AccountType } from '@modules/accounting/entities/account.entity';

export interface AccountBalance {
  accountId: string;
  code: string;
  nameAr: string;
  nameEn: string;
  type: AccountType;
  debit: number;
  credit: number;
  balance: number;
}

@Injectable()
export class FinancialReportsService {
  constructor(
    @InjectRepository(JournalLine)
    private readonly lineRepo: Repository<JournalLine>,
    @InjectRepository(JournalEntry)
    private readonly entryRepo: Repository<JournalEntry>,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
  ) {}

  async getTrialBalance(
    tenantId: string,
    from?: string,
    to?: string,
  ): Promise<{
    accounts: AccountBalance[];
    totalDebit: number;
    totalCredit: number;
  }> {
    const qb = this.lineRepo
      .createQueryBuilder('line')
      .innerJoin('line.entry', 'entry')
      .innerJoin(Account, 'account', 'account.id = line.accountId')
      .select([
        'line.accountId AS "accountId"',
        'account.code AS "code"',
        'account.name_ar AS "nameAr"',
        'account.name_en AS "nameEn"',
        'account.type AS "type"',
        'SUM(line.debit) AS "debit"',
        'SUM(line.credit) AS "credit"',
        'SUM(line.debit) - SUM(line.credit) AS "balance"',
      ])
      .where('entry.tenantId = :tenantId', { tenantId })
      .andWhere('entry.status = :status', { status: JournalEntryStatus.POSTED })
      .groupBy('line.accountId')
      .addGroupBy('account.code')
      .addGroupBy('account.name_ar')
      .addGroupBy('account.name_en')
      .addGroupBy('account.type')
      .orderBy('account.code', 'ASC');

    if (from) qb.andWhere('entry.date >= :from', { from });
    if (to) qb.andWhere('entry.date <= :to', { to });

    const results = await qb.getRawMany();

    const accounts: AccountBalance[] = results.map((r) => ({
      accountId: r.accountId,
      code: r.code,
      nameAr: r.nameAr,
      nameEn: r.nameEn,
      type: r.type,
      debit: Number(r.debit) || 0,
      credit: Number(r.credit) || 0,
      balance: Number(r.balance) || 0,
    }));

    const totalDebit = accounts.reduce((sum, a) => sum + a.debit, 0);
    const totalCredit = accounts.reduce((sum, a) => sum + a.credit, 0);

    return { accounts, totalDebit, totalCredit };
  }

  async getProfitAndLoss(
    tenantId: string,
    from?: string,
    to?: string,
  ): Promise<{
    revenue: AccountBalance[];
    expenses: AccountBalance[];
    totalRevenue: number;
    totalExpenses: number;
    netIncome: number;
  }> {
    const { accounts } = await this.getTrialBalance(tenantId, from, to);

    const revenue = accounts.filter((a) => a.type === AccountType.REVENUE);
    const expenses = accounts.filter((a) => a.type === AccountType.EXPENSE);

    // Revenue is normally credit, so balance is negative; use absolute value
    const totalRevenue = revenue.reduce((sum, a) => sum + Math.abs(a.balance), 0);
    const totalExpenses = expenses.reduce((sum, a) => sum + Math.abs(a.balance), 0);
    const netIncome = totalRevenue - totalExpenses;

    return { revenue, expenses, totalRevenue, totalExpenses, netIncome };
  }

  async getBalanceSheet(
    tenantId: string,
    asOf?: string,
  ): Promise<{
    assets: AccountBalance[];
    liabilities: AccountBalance[];
    equity: AccountBalance[];
    totalAssets: number;
    totalLiabilities: number;
    totalEquity: number;
    totalLiabilitiesAndEquity: number;
  }> {
    const { accounts } = await this.getTrialBalance(tenantId, undefined, asOf);

    const assets = accounts.filter((a) => a.type === AccountType.ASSET);
    const liabilities = accounts.filter((a) => a.type === AccountType.LIABILITY);
    const equity = accounts.filter((a) => a.type === AccountType.EQUITY);

    const totalAssets = assets.reduce((sum, a) => sum + Math.abs(a.balance), 0);
    const totalLiabilities = liabilities.reduce((sum, a) => sum + Math.abs(a.balance), 0);
    const totalEquity = equity.reduce((sum, a) => sum + Math.abs(a.balance), 0);

    return {
      assets,
      liabilities,
      equity,
      totalAssets,
      totalLiabilities,
      totalEquity,
      totalLiabilitiesAndEquity: totalLiabilities + totalEquity,
    };
  }

  async getGeneralLedger(
    tenantId: string,
    accountId: string,
    from?: string,
    to?: string,
  ): Promise<{
    account: { id: string; code: string; nameAr: string; nameEn: string };
    entries: {
      date: string;
      refNumber: string;
      description: string;
      debit: number;
      credit: number;
      balance: number;
    }[];
    totalDebit: number;
    totalCredit: number;
    closingBalance: number;
  }> {
    const account = await this.accountRepo.findOne({
      where: { id: accountId, tenantId },
    });
    if (!account) {
      return {
        account: { id: accountId, code: '', nameAr: '', nameEn: '' },
        entries: [],
        totalDebit: 0,
        totalCredit: 0,
        closingBalance: 0,
      };
    }

    const qb = this.lineRepo
      .createQueryBuilder('line')
      .innerJoin('line.entry', 'entry')
      .select([
        'entry.date AS "date"',
        'entry.refNumber AS "refNumber"',
        'line.description AS "description"',
        'line.debit AS "debit"',
        'line.credit AS "credit"',
      ])
      .where('entry.tenantId = :tenantId', { tenantId })
      .andWhere('entry.status = :status', { status: JournalEntryStatus.POSTED })
      .andWhere('line.accountId = :accountId', { accountId })
      .orderBy('entry.date', 'ASC')
      .addOrderBy('entry.createdAt', 'ASC');

    if (from) qb.andWhere('entry.date >= :from', { from });
    if (to) qb.andWhere('entry.date <= :to', { to });

    const results = await qb.getRawMany();

    let runningBalance = 0;
    const entries = results.map((r) => {
      const debit = Number(r.debit) || 0;
      const credit = Number(r.credit) || 0;
      runningBalance += debit - credit;
      return {
        date: r.date,
        refNumber: r.refNumber,
        description: r.description || '',
        debit,
        credit,
        balance: runningBalance,
      };
    });

    const totalDebit = entries.reduce((sum, e) => sum + e.debit, 0);
    const totalCredit = entries.reduce((sum, e) => sum + e.credit, 0);

    return {
      account: {
        id: account.id,
        code: account.code,
        nameAr: account.nameAr,
        nameEn: account.nameEn || '',
      },
      entries,
      totalDebit,
      totalCredit,
      closingBalance: runningBalance,
    };
  }
}
