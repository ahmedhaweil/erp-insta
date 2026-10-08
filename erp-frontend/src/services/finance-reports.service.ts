import api from '@/lib/api';
import { clean } from './finance-admin.service';

/** Report endpoints (JSON or Excel) and the dashboard KPIs. */

export type AgingBuckets = Record<'current' | '1-30' | '31-60' | '61-90' | '90+', number>;

export interface DashboardData {
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
  pendingOrders: number;
  lowStockProducts: number;
  receivables: { total: number; overdue: number; buckets: AgingBuckets };
  payables: { total: number; overdue: number; buckets: AgingBuckets };
  cash: { balance: number; accounts: { accountId: string; code: string; name: string; balance: number }[] };
  bank: { balance: number; accounts: { accountId: string; code: string; name: string; balance: number }[] };
  topProducts: { productId: string; code: string; name: string; quantity: number; net: number; grossProfit: number }[];
  recentOrders: { id: string; orderNumber: string; customerName: string; totalAmount: number; status: string; date: string }[];
}

export const finReportsService = {
  getDashboard: () => api.get('/reports/dashboard').then((r) => r.data.data as DashboardData),

  getReport: (endpoint: string, params: Record<string, unknown>) =>
    api.get(`/reports/${endpoint}`, { params: clean(params) }).then((r) => r.data.data),

  /** Downloads the Excel version of a report (?format=xlsx&lang=). */
  downloadXlsx: async (endpoint: string, params: Record<string, unknown>, lang: string) => {
    const res = await api.get(`/reports/${endpoint}`, {
      params: clean({ ...params, format: 'xlsx', lang }),
      responseType: 'blob',
    });
    const disposition: string = res.headers['content-disposition'] || '';
    const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
    const filename = match ? decodeURIComponent(match[1]) : `${endpoint}.xlsx`;
    const url = URL.createObjectURL(res.data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
