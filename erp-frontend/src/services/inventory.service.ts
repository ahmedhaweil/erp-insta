import api from '@/lib/api';
import type { Product, Warehouse, Stock, ApiResponse } from '@/types';

export const inventoryService = {
  // Products
  getProducts: () =>
    api.get<ApiResponse<Product[]>>('/inventory/products').then((r) => r.data.data),

  getProduct: (id: string) =>
    api.get<ApiResponse<Product>>(`/inventory/products/${id}`).then((r) => r.data.data),

  createProduct: (data: Partial<Product>) =>
    api.post<ApiResponse<Product>>('/inventory/products', data).then((r) => r.data.data),

  updateProduct: (id: string, data: Partial<Product>) =>
    api.patch<ApiResponse<Product>>(`/inventory/products/${id}`, data).then((r) => r.data.data),

  // Warehouses
  getWarehouses: () =>
    api.get<ApiResponse<Warehouse[]>>('/inventory/warehouses').then((r) => r.data.data),

  // Stock
  getStock: () =>
    api.get<ApiResponse<Stock[]>>('/inventory/stock').then((r) => r.data.data),

  adjustStock: (data: { productId: string; warehouseId: string; quantity: number; reason: string }) =>
    api.post<ApiResponse<any>>('/inventory/stock/adjust', data).then((r) => r.data.data),

  transferStock: (data: { productId: string; fromWarehouseId: string; toWarehouseId: string; quantity: number }) =>
    api.post<ApiResponse<any>>('/inventory/stock/transfer', data).then((r) => r.data.data),
};
