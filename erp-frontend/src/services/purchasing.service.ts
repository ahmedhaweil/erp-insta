import api from '@/lib/api';
import type { Supplier, PurchaseOrder, PurchaseInvoice, ApiResponse } from '@/types';

export const purchasingService = {
  // Suppliers
  getSuppliers: () =>
    api.get<ApiResponse<Supplier[]>>('/purchasing/suppliers').then((r) => r.data.data),

  getSupplier: (id: string) =>
    api.get<ApiResponse<Supplier>>(`/purchasing/suppliers/${id}`).then((r) => r.data.data),

  createSupplier: (data: Partial<Supplier>) =>
    api.post<ApiResponse<Supplier>>('/purchasing/suppliers', data).then((r) => r.data.data),

  updateSupplier: (id: string, data: Partial<Supplier>) =>
    api.patch<ApiResponse<Supplier>>(`/purchasing/suppliers/${id}`, data).then((r) => r.data.data),

  // Purchase Orders
  getPurchaseOrders: () =>
    api.get<ApiResponse<PurchaseOrder[]>>('/purchasing/orders').then((r) => r.data.data),

  getPurchaseOrder: (id: string) =>
    api.get<ApiResponse<PurchaseOrder>>(`/purchasing/orders/${id}`).then((r) => r.data.data),

  createPurchaseOrder: (data: any) =>
    api.post<ApiResponse<PurchaseOrder>>('/purchasing/orders', data).then((r) => r.data.data),

  confirmPurchaseOrder: (id: string) =>
    api.post<ApiResponse<PurchaseOrder>>(`/purchasing/orders/${id}/confirm`).then((r) => r.data.data),

  cancelPurchaseOrder: (id: string) =>
    api.post<ApiResponse<PurchaseOrder>>(`/purchasing/orders/${id}/cancel`).then((r) => r.data.data),

  // Purchase Invoices
  getPurchaseInvoices: () =>
    api.get<ApiResponse<PurchaseInvoice[]>>('/purchasing/invoices').then((r) => r.data.data),

  getPurchaseInvoice: (id: string) =>
    api.get<ApiResponse<PurchaseInvoice>>(`/purchasing/invoices/${id}`).then((r) => r.data.data),

  createPurchaseInvoice: (data: any) =>
    api.post<ApiResponse<PurchaseInvoice>>('/purchasing/invoices', data).then((r) => r.data.data),

  approvePurchaseInvoice: (id: string) =>
    api.post<ApiResponse<PurchaseInvoice>>(`/purchasing/invoices/${id}/approve`).then((r) => r.data.data),

  markPurchaseInvoicePaid: (id: string) =>
    api.post<ApiResponse<PurchaseInvoice>>(`/purchasing/invoices/${id}/pay`).then((r) => r.data.data),

  receivePurchaseOrder: (id: string, data: { warehouseId?: string; lines?: { lineId: string; quantity: number }[] } = {}) =>
    api.post<ApiResponse<PurchaseOrder>>(`/purchasing/orders/${id}/receive`, data).then((r) => r.data.data),

  billPurchaseOrder: (id: string, data: { supplierReference?: string; post?: boolean } = {}) =>
    api.post<ApiResponse<PurchaseInvoice>>(`/purchasing/orders/${id}/bill`, data).then((r) => r.data.data),

  cancelPurchaseInvoice: (id: string) =>
    api.post<ApiResponse<PurchaseInvoice>>(`/purchasing/invoices/${id}/cancel`).then((r) => r.data.data),

  refundPurchaseInvoice: (id: string, data: { reason?: string; post?: boolean } = {}) =>
    api.post<ApiResponse<PurchaseInvoice>>(`/purchasing/invoices/${id}/refund`, data).then((r) => r.data.data),

  getReplenishment: () =>
    api.get<ApiResponse<any[]>>('/purchasing/replenishment').then((r) => r.data.data),

  generateReplenishment: (data: { warehouseId?: string; productIds?: string[] } = {}) =>
    api.post<ApiResponse<{ orders: PurchaseOrder[]; skipped: any[] }>>('/purchasing/replenishment/generate', data).then((r) => r.data.data),
};
