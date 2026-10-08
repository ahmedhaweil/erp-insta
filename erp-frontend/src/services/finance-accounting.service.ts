import api from '@/lib/api';

/** Accounting setup, settings, fiscal years, fixed assets, budgets and journal entries. */

const d = <T>(p: Promise<{ data: { data: T } }>) => p.then((r) => r.data.data);

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

export interface FinAccount {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  type: AccountType;
  parentId: string | null;
  level: number;
  isActive: boolean;
  allowPosting: boolean;
  description: string | null;
}

export interface ChartTemplate {
  code: 'eg' | 'sa';
  nameAr: string;
  nameEn: string;
  country: string;
  baseCurrency: string;
  accounts: number;
  postableAccounts: number;
}

export interface TemplateAccount {
  code: string;
  nameAr: string;
  nameEn: string;
  type: AccountType;
  parentCode: string | null;
  level: number;
  allowPosting: boolean;
}

export interface FiscalYear {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'open' | 'closed';
}

export interface FixedAsset {
  id: string;
  code: string;
  name: string;
  purchaseDate: string;
  purchaseValue: number | string;
  usefulLifeMonths: number;
  depreciationMethod: 'straight_line' | 'declining_balance';
  accountId: string | null;
  accumulatedDepreciation: number | string;
  isDisposed: boolean;
  salvageValue: number | string;
  decliningRate: number | string;
  lastDepreciationDate: string | null;
  depreciationExpenseAccountId: string | null;
  accumulatedDepreciationAccountId: string | null;
  disposalDate: string | null;
  disposalAmount: number | string | null;
}

export interface ScheduleRow {
  date: string;
  amount: number;
  accumulated: number;
  bookValue: number;
  posted: boolean;
}

export interface Budget {
  id: string;
  fiscalYearId: string;
  accountId: string;
  costCenterId: string | null;
  period: 'monthly' | 'quarterly' | 'annual';
  amount: number | string;
}

export interface JournalLineRow {
  id?: string;
  accountId: string;
  costCenterId?: string | null;
  debit: number | string;
  credit: number | string;
  amountCurrency?: number | string | null;
  description?: string | null;
  branchId?: string | null;
}

export interface JournalEntryRow {
  id: string;
  journalId: string;
  refNumber: string;
  date: string;
  description: string | null;
  currencyId: string | null;
  exchangeRate: number | string;
  status: 'draft' | 'posted' | 'cancelled';
  postedAt: string | null;
  sourceType: string | null;
  sourceId: string | null;
  reversedEntryId: string | null;
  createdAt: string;
  lines: JournalLineRow[];
}

export interface CreateJournalEntryInput {
  journalId: string;
  date: string;
  description?: string;
  currencyId?: string;
  exchangeRate?: number;
  lines: { accountId: string; debit: number; credit: number; description?: string; branchId?: string; amountCurrency?: number }[];
}

/** Default account keys of the accounting settings (all suffixed AccountId). */
export const SETTINGS_ACCOUNT_KEYS = [
  'receivable',
  'payable',
  'sales',
  'purchase',
  'inventory',
  'cogs',
  'stockAdjustment',
  'outputTax',
  'inputTax',
  'cash',
  'bank',
  'retainedEarnings',
  'depreciationExpense',
  'accumulatedDepreciation',
  'assetDisposal',
  'notesReceivable',
  'chequesUnderCollection',
  'notesPayable',
  'fxGain',
  'fxLoss',
  'bankCharges',
  'withholdingTaxReceivable',
  'withholdingTaxPayable',
  'salesReturn',
  'salesDiscount',
  'purchaseReturn',
  'salariesExpense',
  'salariesPayable',
  'socialInsuranceExpense',
  'socialInsurancePayable',
  'payrollTaxPayable',
  'employeeAdvances',
  'commissionExpense',
  'commissionPayable',
  'installmentInterest',
  'manufacturingOverhead',
] as const;

export type AccountingSettings = Partial<Record<`${(typeof SETTINGS_ACCOUNT_KEYS)[number]}AccountId`, string | null>> & {
  id?: string;
  lockDate?: string | null;
};

export const finAccountingService = {
  getAccounts: () => d<FinAccount[]>(api.get('/accounting/accounts')),
  createAccount: (data: Partial<FinAccount>) => d<FinAccount>(api.post('/accounting/accounts', data)),
  updateAccount: (id: string, data: Partial<FinAccount>) => d<FinAccount>(api.patch(`/accounting/accounts/${id}`, data)),

  // setup wizard
  getTemplates: () => d<ChartTemplate[]>(api.get('/accounting/setup/templates')),
  previewTemplate: (code: string) => d<TemplateAccount[]>(api.get(`/accounting/setup/templates/${code}`)),
  setup: (data: { template: 'eg' | 'sa'; fiscalYearStart: string; baseCurrency?: string }) =>
    d<unknown>(api.post('/accounting/setup', data)),

  // settings
  getSettings: () => d<AccountingSettings | null>(api.get('/accounting/settings')),
  updateSettings: (data: AccountingSettings) => d<AccountingSettings>(api.put('/accounting/settings', data)),

  // fiscal years
  getFiscalYears: () => d<FiscalYear[]>(api.get('/accounting/fiscal-years')),
  createFiscalYear: (data: { name: string; startDate: string; endDate: string }) =>
    d<FiscalYear>(api.post('/accounting/fiscal-years', data)),
  closeFiscalYear: (id: string) => d<unknown>(api.post(`/accounting/fiscal-years/${id}/close`)),

  // fixed assets
  getFixedAssets: () => d<FixedAsset[]>(api.get('/accounting/fixed-assets')),
  createFixedAsset: (data: Record<string, unknown>) => d<FixedAsset>(api.post('/accounting/fixed-assets', data)),
  getSchedule: (id: string) => d<ScheduleRow[]>(api.get(`/accounting/fixed-assets/${id}/schedule`)),
  runDepreciation: (asOf?: string) =>
    d<{ asOf: string; assets: { assetId: string; code: string; posted: number; amount: number }[] }>(
      api.post('/accounting/fixed-assets/depreciate', asOf ? { asOf } : {}),
    ),
  disposeAsset: (id: string, data: { date: string; saleAmount?: number }) =>
    d<unknown>(api.post(`/accounting/fixed-assets/${id}/dispose`, data)),

  // budgets
  getBudgets: () => d<Budget[]>(api.get('/accounting/budgets')),
  createBudget: (data: { fiscalYearId: string; accountId: string; period?: string; amount: number }) =>
    d<Budget>(api.post('/accounting/budgets', data)),

  // journal entries
  getJournalEntries: () => d<JournalEntryRow[]>(api.get('/accounting/journal-entries')),
  createJournalEntry: (data: CreateJournalEntryInput) => d<JournalEntryRow>(api.post('/accounting/journal-entries', data)),
  postJournalEntry: (id: string) => d<JournalEntryRow>(api.patch(`/accounting/journal-entries/${id}/post`)),
  reverseJournalEntry: (id: string) => d<JournalEntryRow>(api.post(`/accounting/journal-entries/${id}/reverse`)),
  cancelJournalEntry: (id: string) => d<JournalEntryRow>(api.post(`/accounting/journal-entries/${id}/cancel`)),
};
