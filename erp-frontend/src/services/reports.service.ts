import api from '@/lib/api';

export const reportsService = {
  getDashboard: async () => {
    const { data } = await api.get('/reports/dashboard');
    return data.data;
  },

  getTrialBalance: async (from?: string, to?: string) => {
    const params: Record<string, string> = {};
    if (from) params.from = from;
    if (to) params.to = to;
    const { data } = await api.get('/reports/trial-balance', { params });
    return data.data;
  },

  getProfitLoss: async (from?: string, to?: string) => {
    const params: Record<string, string> = {};
    if (from) params.from = from;
    if (to) params.to = to;
    const { data } = await api.get('/reports/profit-loss', { params });
    return data.data;
  },

  getBalanceSheet: async (asOf?: string) => {
    const params: Record<string, string> = {};
    if (asOf) params.asOf = asOf;
    const { data } = await api.get('/reports/balance-sheet', { params });
    return data.data;
  },

  getGeneralLedger: async (accountId: string, from?: string, to?: string) => {
    const params: Record<string, string> = { accountId };
    if (from) params.from = from;
    if (to) params.to = to;
    const { data } = await api.get('/reports/general-ledger', { params });
    return data.data;
  },
};
