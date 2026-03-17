import api from '@/lib/api';
import type { Account, JournalEntry, ApiResponse } from '@/types';

export const accountingService = {
  // Accounts
  getAccounts: () =>
    api.get<ApiResponse<Account[]>>('/accounting/accounts').then((r) => r.data.data),

  getAccount: (id: string) =>
    api.get<ApiResponse<Account>>(`/accounting/accounts/${id}`).then((r) => r.data.data),

  createAccount: (data: Partial<Account>) =>
    api.post<ApiResponse<Account>>('/accounting/accounts', data).then((r) => r.data.data),

  updateAccount: (id: string, data: Partial<Account>) =>
    api.patch<ApiResponse<Account>>(`/accounting/accounts/${id}`, data).then((r) => r.data.data),

  // Journal Entries
  getJournalEntries: () =>
    api.get<ApiResponse<JournalEntry[]>>('/accounting/journal-entries').then((r) => r.data.data),

  getJournalEntry: (id: string) =>
    api.get<ApiResponse<JournalEntry>>(`/accounting/journal-entries/${id}`).then((r) => r.data.data),

  createJournalEntry: (data: any) =>
    api.post<ApiResponse<JournalEntry>>('/accounting/journal-entries', data).then((r) => r.data.data),

  postJournalEntry: (id: string) =>
    api.post<ApiResponse<JournalEntry>>(`/accounting/journal-entries/${id}/post`).then((r) => r.data.data),

  reverseJournalEntry: (id: string) =>
    api.post<ApiResponse<JournalEntry>>(`/accounting/journal-entries/${id}/reverse`).then((r) => r.data.data),
};
