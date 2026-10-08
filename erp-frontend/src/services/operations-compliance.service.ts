import { ops, type Row } from './operations-api';

const C = '/compliance';

export interface ComplianceListParams {
  provider?: string;
  status?: string;
  from?: string;
  to?: string;
  search?: string;
  page?: number;
  limit?: number;
  order?: 'asc' | 'desc';
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const opsCompliance = {
  taxConfigs: () => ops.get<Row[]>(`${C}/tax-configs`),
  createTaxConfig: (body: any) => ops.post<Row>(`${C}/tax-configs`, body),

  settings: () => ops.get<any>(`${C}/settings`),
  updateSettings: (body: any) => ops.put<any>(`${C}/settings`, body),

  itemCodes: () => ops.get<Row[]>(`${C}/item-codes`),
  createItemCode: (body: any) => ops.post<Row>(`${C}/item-codes`, body),
  updateItemCode: (id: string, body: any) => ops.put<Row>(`${C}/item-codes/${id}`, body),
  deleteItemCode: (id: string) => ops.del(`${C}/item-codes/${id}`),

  party: (customerId: string) => ops.get<Row | null>(`${C}/parties/${customerId}`),
  upsertParty: (customerId: string, body: any) => ops.put<Row>(`${C}/parties/${customerId}`, body),

  eInvoices: (params: ComplianceListParams) => ops.get<Paged<Row>>(`${C}/e-invoices`, params as any),
  eInvoice: (id: string) => ops.get<Row>(`${C}/e-invoices/${id}`),
  previewInvoice: (invoiceId: string, invoiceType?: string) =>
    ops.get<any>(`${C}/e-invoices/preview/${invoiceId}`, { invoiceType }),
  submitInvoice: (invoiceId: string, invoiceType?: string) => ops.post<Row>(`${C}/e-invoices/submit`, { invoiceId, invoiceType }),
  refreshPending: () => ops.post<any>(`${C}/e-invoices/refresh-pending`),
  refreshInvoice: (id: string) => ops.post<Row>(`${C}/e-invoices/${id}/refresh`),
  cancelInvoice: (id: string, reason: string) => ops.post<Row>(`${C}/e-invoices/${id}/cancel`, { reason }),
  invoiceQr: (id: string) => ops.get<any>(`${C}/e-invoices/${id}/qr`),

  eReceipts: (params: ComplianceListParams) => ops.get<Paged<Row>>(`${C}/e-receipts`, params as any),
  previewReceipt: (posOrderId: string) => ops.get<any>(`${C}/e-receipts/preview/${posOrderId}`),
  submitReceipt: (posOrderId: string) => ops.post<Row>(`${C}/e-receipts/submit`, { posOrderId }),
  refreshReceipt: (id: string) => ops.post<Row>(`${C}/e-receipts/${id}/refresh`),
  receiptQr: (id: string) => ops.get<any>(`${C}/e-receipts/${id}/qr`),
};
