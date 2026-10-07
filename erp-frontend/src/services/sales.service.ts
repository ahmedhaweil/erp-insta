import api from '@/lib/api';
import type { Customer, SalesOrder, SalesInvoice, ApiResponse } from '@/types';

export const salesService = {
  // Customers
  getCustomers: () =>
    api.get<ApiResponse<Customer[]>>('/sales/customers').then((r) => r.data.data),

  getCustomer: (id: string) =>
    api.get<ApiResponse<Customer>>(`/sales/customers/${id}`).then((r) => r.data.data),

  createCustomer: (data: Partial<Customer>) =>
    api.post<ApiResponse<Customer>>('/sales/customers', data).then((r) => r.data.data),

  updateCustomer: (id: string, data: Partial<Customer>) =>
    api.patch<ApiResponse<Customer>>(`/sales/customers/${id}`, data).then((r) => r.data.data),

  // Sales Orders
  getSalesOrders: () =>
    api.get<ApiResponse<SalesOrder[]>>('/sales/orders').then((r) => r.data.data),

  getSalesOrder: (id: string) =>
    api.get<ApiResponse<SalesOrder>>(`/sales/orders/${id}`).then((r) => r.data.data),

  createSalesOrder: (data: any) =>
    api.post<ApiResponse<SalesOrder>>('/sales/orders', data).then((r) => r.data.data),

  confirmSalesOrder: (id: string) =>
    api.post<ApiResponse<SalesOrder>>(`/sales/orders/${id}/confirm`).then((r) => r.data.data),

  cancelSalesOrder: (id: string) =>
    api.post<ApiResponse<SalesOrder>>(`/sales/orders/${id}/cancel`).then((r) => r.data.data),

  // Sales Invoices
  getSalesInvoices: () =>
    api.get<ApiResponse<SalesInvoice[]>>('/sales/invoices').then((r) => r.data.data),

  getSalesInvoice: (id: string) =>
    api.get<ApiResponse<SalesInvoice>>(`/sales/invoices/${id}`).then((r) => r.data.data),

  createSalesInvoice: (data: any) =>
    api.post<ApiResponse<SalesInvoice>>('/sales/invoices', data).then((r) => r.data.data),

  markInvoicePaid: (id: string) =>
    api.post<ApiResponse<SalesInvoice>>(`/sales/invoices/${id}/pay`).then((r) => r.data.data),

  sendQuotation: (id: string) =>
    api.post<ApiResponse<SalesOrder>>(`/sales/orders/${id}/send`).then((r) => r.data.data),

  deliverSalesOrder: (id: string, data: { warehouseId?: string; lines?: { lineId: string; quantity: number }[] } = {}) =>
    api.post<ApiResponse<SalesOrder>>(`/sales/orders/${id}/deliver`, data).then((r) => r.data.data),

  invoiceSalesOrder: (id: string, data: { policy?: 'ordered' | 'delivered'; post?: boolean } = {}) =>
    api.post<ApiResponse<SalesInvoice>>(`/sales/orders/${id}/invoice`, data).then((r) => r.data.data),

  postInvoice: (id: string) =>
    api.post<ApiResponse<SalesInvoice>>(`/sales/invoices/${id}/post`).then((r) => r.data.data),

  cancelInvoice: (id: string) =>
    api.post<ApiResponse<SalesInvoice>>(`/sales/invoices/${id}/cancel`).then((r) => r.data.data),

  createCreditNote: (id: string, data: { reason?: string; post?: boolean } = {}) =>
    api.post<ApiResponse<SalesInvoice>>(`/sales/invoices/${id}/credit-note`, data).then((r) => r.data.data),
};
