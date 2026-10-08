import { ops, type Row } from './operations-api';

const P = '/inventory';

export const opsInventory = {
  // Products
  products: () => ops.get<Row[]>(`${P}/products`),
  product: (id: string) => ops.get<Row>(`${P}/products/${id}`),
  createProduct: (body: any) => ops.post<Row>(`${P}/products`, body),
  updateProduct: (id: string, body: any) => ops.patch<Row>(`${P}/products/${id}`, body),
  deleteProduct: (id: string) => ops.del(`${P}/products/${id}`),
  byBarcode: (code: string) =>
    ops.get<{ product: Row; unitId: string | null; unitName?: string; factor: number; price: number; productUnitId?: string }>(
      `${P}/products/barcode/${encodeURIComponent(code)}`,
    ),
  productUnits: (id: string) => ops.get<Row[]>(`${P}/products/${id}/units`),
  upsertProductUnit: (id: string, body: any) => ops.post<Row>(`${P}/products/${id}/units`, body),
  deleteProductUnit: (id: string, productUnitId: string) => ops.del(`${P}/products/${id}/units/${productUnitId}`),

  // Master data
  categories: () => ops.get<Row[]>(`${P}/categories`),
  createCategory: (body: any) => ops.post<Row>(`${P}/categories`, body),
  updateCategory: (id: string, body: any) => ops.patch<Row>(`${P}/categories/${id}`, body),
  units: () => ops.get<Row[]>(`${P}/units`),
  createUnit: (body: any) => ops.post<Row>(`${P}/units`, body),
  updateUnit: (id: string, body: any) => ops.patch<Row>(`${P}/units/${id}`, body),
  warehouses: () => ops.get<Row[]>(`${P}/warehouses`),
  createWarehouse: (body: any) => ops.post<Row>(`${P}/warehouses`, body),
  updateWarehouse: (id: string, body: any) => ops.patch<Row>(`${P}/warehouses/${id}`, body),

  // Stock
  stock: (params?: { productId?: string; warehouseId?: string }) => ops.get<Row[]>(`${P}/stock`, params),
  movements: (params?: {
    productId?: string;
    warehouseId?: string;
    from?: string;
    to?: string;
    referenceType?: string;
    limit?: number;
    offset?: number;
  }) => ops.get<Row[]>(`${P}/stock/movements`, params),
  adjust: (body: any) => ops.post(`${P}/stock/adjust`, body),
  receive: (body: any) => ops.post(`${P}/stock/receive`, body),
  settings: () => ops.get<{ allowNegativeStock: boolean; expiryAlertDays: number }>(`${P}/settings`),
  updateSettings: (body: any) => ops.put(`${P}/settings`, body),

  // Transfers
  transfers: (params?: { status?: string; warehouseId?: string }) => ops.get<Row[]>(`${P}/transfers`, params),
  transfer: (id: string) => ops.get<Row>(`${P}/transfers/${id}`),
  createTransfer: (body: any) => ops.post<Row>(`${P}/transfers`, body),
  shipTransfer: (id: string) => ops.post(`${P}/transfers/${id}/ship`),
  receiveTransfer: (id: string, body?: any) => ops.post(`${P}/transfers/${id}/receive`, body),
  validateTransfer: (id: string) => ops.post(`${P}/transfers/${id}/validate`),
  cancelTransfer: (id: string) => ops.post(`${P}/transfers/${id}/cancel`),

  // Stock counts
  counts: (params?: { status?: string; warehouseId?: string }) => ops.get<Row[]>(`${P}/stock-counts`, params),
  count: (id: string) => ops.get<Row>(`${P}/stock-counts/${id}`),
  createCount: (body: any) => ops.post<Row>(`${P}/stock-counts`, body),
  updateCountLines: (id: string, lines: any[]) => ops.put<Row>(`${P}/stock-counts/${id}/lines`, { lines }),
  validateCount: (id: string, body: { zeroUncounted?: boolean }) => ops.post(`${P}/stock-counts/${id}/validate`, body),
  cancelCount: (id: string) => ops.post(`${P}/stock-counts/${id}/cancel`),

  // Lots
  lots: (params?: { productId?: string; warehouseId?: string; includeEmpty?: boolean }) => ops.get<Row[]>(`${P}/lots`, params),
  expiringLots: (params?: { days?: number; warehouseId?: string }) => ops.get<any>(`${P}/lots/expiring`, params),
  expiredLots: (params?: { warehouseId?: string }) => ops.get<any>(`${P}/lots/expired`, params),
  traceLot: (productId: string, lotNumber: string) => ops.get<any>(`${P}/lots/trace`, { productId, lotNumber }),

  // Reports
  itemCard: (params: { productId: string; warehouseId?: string; from?: string; to?: string }) =>
    ops.get<any>(`${P}/reports/item-card`, params),
  stockBalance: (params?: { warehouseId?: string; categoryId?: string; includeZero?: boolean }) =>
    ops.get<any>(`${P}/reports/stock-balance`, params),
  slowMoving: (params?: { days?: number; warehouseId?: string }) => ops.get<any>(`${P}/reports/slow-moving`, params),
  negativeStock: (params?: { warehouseId?: string }) => ops.get<any>(`${P}/reports/negative-stock`, params),
  reorder: (params?: { warehouseId?: string }) => ops.get<any>(`${P}/reports/reorder`, params),
};

/** Branches are owned by the tenants module; needed to create warehouses and terminals. */
export const opsBranches = () => ops.get<Row[]>('/branches');
