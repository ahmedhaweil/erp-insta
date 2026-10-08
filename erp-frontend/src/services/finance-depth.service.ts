import api from '@/lib/api';

/** Accounting depth: recurring entries, deferrals, FX revaluation, opening balances, period closing. */

const d = <T>(p: Promise<{ data: { data: T } }>) => p.then((r) => r.data.data);

export type RecurringFrequency = 'monthly' | 'quarterly' | 'yearly' | 'days';
export type RecurringStatus = 'active' | 'paused' | 'done';

export interface RecurringLine {
  id?: string;
  accountId: string;
  debit: number | string;
  credit: number | string;
  description?: string | null;
  costCenterId?: string | null;
  branchId?: string | null;
}

export interface RecurringEntry {
  id: string;
  name: string;
  description: string | null;
  journalId: string | null;
  frequency: RecurringFrequency;
  intervalDays: number | null;
  startDate: string;
  endDate: string | null;
  nextRunDate: string | null;
  lastRunDate: string | null;
  runCount: number;
  autoPost: boolean;
  status: RecurringStatus;
  currencyId: string | null;
  exchangeRate: number | string;
  lines?: RecurringLine[];
  upcoming?: string[];
  runs?: { id: string; runDate: string; entryId: string }[];
}

export interface RecurringRunResult {
  asOf: string;
  results: { templateId: string; name: string; generated: { date: string; entryId: string; refNumber: string; status: string }[]; error?: string }[];
}

export type DeferralType = 'revenue' | 'expense';

export interface Deferral {
  id: string;
  scheduleNumber: string;
  type: DeferralType;
  name: string;
  reference: string | null;
  amount: number | string;
  deferralAccountId: string;
  plAccountId: string;
  counterpartAccountId: string | null;
  startDate: string;
  months: number;
  recognizedAmount: number | string;
  status: 'active' | 'completed' | 'cancelled';
  costCenterId: string | null;
  branchId: string | null;
  lines?: { id: string; sequence: number; date: string; amount: number | string; status: 'planned' | 'posted' | 'cancelled'; entryId: string | null }[];
}

export interface FxItem {
  kind: 'receivable' | 'payable' | 'treasury';
  currencyId: string;
  currencyCode?: string;
  accountId: string | null;
  treasuryId?: string;
  label: string;
  documents?: number;
  foreignAmount: number;
  bookedBase: number;
  rate: number;
  revaluedBase: number;
  difference: number;
  gainLoss: number;
}

export interface FxPreview {
  date: string;
  reversalDate: string;
  rates: Record<string, number>;
  items: FxItem[];
  totalGain: number;
  totalLoss: number;
  net: number;
  warnings: string[];
}

export interface FxRevaluation {
  id: string;
  revaluationNumber: string;
  date: string;
  reversalDate: string;
  status: 'posted' | 'reversed';
  rates: Record<string, number>;
  items: FxItem[];
  totalGain: number | string;
  totalLoss: number | string;
  entryId: string | null;
  reversalEntryId: string | null;
  createdAt: string;
}

export interface OpeningBalance {
  id: string;
  kind: 'accounts' | 'customer' | 'supplier';
  date: string;
  partnerId: string | null;
  documentId: string | null;
  documentNumber: string | null;
  amount: number | string;
  currencyId: string | null;
  exchangeRate: number | string;
  entryId: string | null;
  description: string | null;
  createdAt: string;
}

export interface ClosingCheck {
  code: string;
  count: number;
  message: string;
}

export interface ClosingChecklist {
  date: string;
  currentLockDate: string | null;
  checks: ClosingCheck[];
  warnings: ClosingCheck[];
  ready: boolean;
}

export interface PeriodClosingLog {
  id: string;
  action: 'lock' | 'reopen';
  lockDate: string | null;
  previousLockDate: string | null;
  warnings: ClosingCheck[];
  notes: string | null;
  userId: string;
  createdAt: string;
}

export const depthService = {
  // recurring
  recurring: () => d<RecurringEntry[]>(api.get('/accounting/recurring-entries')),
  recurringById: (id: string) => d<RecurringEntry>(api.get(`/accounting/recurring-entries/${id}`)),
  createRecurring: (body: Record<string, unknown>) => d<RecurringEntry>(api.post('/accounting/recurring-entries', body)),
  updateRecurring: (id: string, body: Record<string, unknown>) => d<RecurringEntry>(api.patch(`/accounting/recurring-entries/${id}`, body)),
  runRecurringDue: (asOf?: string) => d<RecurringRunResult>(api.post('/accounting/recurring-entries/run-due', asOf ? { asOf } : {})),
  runRecurringOne: (id: string, asOf?: string) =>
    d<RecurringRunResult>(api.post(`/accounting/recurring-entries/${id}/run`, asOf ? { asOf } : {})),

  // deferrals
  deferrals: (type?: DeferralType) => d<Deferral[]>(api.get('/accounting/deferrals', { params: type ? { type } : {} })),
  deferral: (id: string) => d<Deferral>(api.get(`/accounting/deferrals/${id}`)),
  createDeferral: (body: Record<string, unknown>) => d<Deferral>(api.post('/accounting/deferrals', body)),
  runDeferralsDue: (asOf?: string) =>
    d<{ asOf: string; schedules: { scheduleId: string; scheduleNumber: string; posted: number; amount: number; error?: string }[] }>(
      api.post('/accounting/deferrals/run-due', asOf ? { asOf } : {}),
    ),
  cancelDeferral: (id: string, body: { recognizeRemaining?: boolean; date?: string }) =>
    d<Deferral>(api.post(`/accounting/deferrals/${id}/cancel`, body)),

  // fx revaluation
  revaluations: () => d<FxRevaluation[]>(api.get('/accounting/fx-revaluations')),
  previewRevaluation: (body: { date: string; rates?: { currencyId: string; rate: number }[]; reversalDate?: string }) =>
    d<FxPreview>(api.post('/accounting/fx-revaluations/preview', body)),
  postRevaluation: (body: { date: string; rates?: { currencyId: string; rate: number }[]; reversalDate?: string }) =>
    d<FxRevaluation>(api.post('/accounting/fx-revaluations', body)),
  reverseRevaluation: (id: string, date?: string) =>
    d<FxRevaluation>(api.post(`/accounting/fx-revaluations/${id}/reverse`, date ? { date } : {})),

  // opening balances
  openings: (kind?: string) => d<OpeningBalance[]>(api.get('/accounting/opening-balances', { params: kind ? { kind } : {} })),
  postOpeningAccounts: (body: Record<string, unknown>) => d<unknown>(api.post('/accounting/opening-balances/accounts', body)),
  postOpeningPartners: (body: Record<string, unknown>) => d<unknown>(api.post('/accounting/opening-balances/partners', body)),

  // period closing
  checklist: (date?: string) => d<ClosingChecklist>(api.get('/accounting/period-closing/checklist', { params: date ? { date } : {} })),
  closingHistory: () => d<PeriodClosingLog[]>(api.get('/accounting/period-closing/history')),
  lock: (body: { period?: string; date?: string; notes?: string }) =>
    d<{ lockDate: string; previousLockDate: string | null; warnings: ClosingCheck[] }>(api.post('/accounting/period-closing/lock', body)),
  reopen: (body: { date?: string; notes?: string }) =>
    d<{ lockDate: string | null; previousLockDate: string }>(api.post('/accounting/period-closing/reopen', body)),
};
