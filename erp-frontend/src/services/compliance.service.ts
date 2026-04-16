import api from '@/lib/api';
import type { TaxConfig, EInvoice, ApiResponse } from '@/types';

export const complianceService = {
  getTaxConfigs: () =>
    api.get<ApiResponse<TaxConfig[]>>('/compliance/tax-configs').then((r) => r.data.data),

  createTaxConfig: (data: Partial<TaxConfig>) =>
    api.post<ApiResponse<TaxConfig>>('/compliance/tax-configs', data).then((r) => r.data.data),

  getEInvoices: () =>
    api.get<ApiResponse<EInvoice[]>>('/compliance/e-invoices').then((r) => r.data.data),

  submitInvoice: (data: { invoiceId: string; invoiceType: 'sales' | 'purchase' }) =>
    api.post<ApiResponse<EInvoice>>('/compliance/e-invoices/submit', data).then((r) => r.data.data),
};
