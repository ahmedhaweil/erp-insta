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
};
