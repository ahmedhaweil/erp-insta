import { ops, type Row } from './operations-api';

const U = '/purchasing';

export const opsPurchasing = {
  suppliers: () => ops.get<Row[]>(`${U}/suppliers`),
  createSupplier: (body: any) => ops.post<Row>(`${U}/suppliers`, body),
  updateSupplier: (id: string, body: any) => ops.patch<Row>(`${U}/suppliers/${id}`, body),
  deleteSupplier: (id: string) => ops.del(`${U}/suppliers/${id}`),

  // Requisitions
  requisitions: (status?: string) => ops.get<Row[]>(`${U}/requisitions`, { status }),
  createRequisition: (body: any) => ops.post<Row>(`${U}/requisitions`, body),
  submitRequisition: (id: string) => ops.post(`${U}/requisitions/${id}/submit`),
  approveRequisition: (id: string) => ops.post(`${U}/requisitions/${id}/approve`),
  rejectRequisition: (id: string, reason?: string) => ops.post(`${U}/requisitions/${id}/reject`, { reason }),
  cancelRequisition: (id: string) => ops.post(`${U}/requisitions/${id}/cancel`),
  convertRequisition: (id: string, body: { supplierId?: string; date?: string }) =>
    ops.post(`${U}/requisitions/${id}/convert`, body),

  // RFQ / purchase orders
  orders: () => ops.get<Row[]>(`${U}/orders`),
  order: (id: string) => ops.get<Row>(`${U}/orders/${id}`),
  createOrder: (body: any) => ops.post<Row>(`${U}/orders`, body),
  sendOrder: (id: string) => ops.post(`${U}/orders/${id}/send`),
  confirmOrder: (id: string) => ops.post<Row>(`${U}/orders/${id}/confirm`),
  approveOrder: (id: string) => ops.post(`${U}/orders/${id}/approve`),
  rejectOrder: (id: string, reason?: string) => ops.post(`${U}/orders/${id}/reject`, { reason }),
  cancelOrder: (id: string) => ops.post(`${U}/orders/${id}/cancel`),
  receiveOrder: (id: string, body: { warehouseId?: string; lines?: { lineId: string; quantity: number }[] }) =>
    ops.post(`${U}/orders/${id}/receive`, body),
  billOrder: (id: string, body: { date?: string; supplierReference?: string; post?: boolean }) =>
    ops.post<Row>(`${U}/orders/${id}/bill`, body),

  // Vendor bills
  bills: () => ops.get<Row[]>(`${U}/invoices`),
  bill: (id: string) => ops.get<Row>(`${U}/invoices/${id}`),
  createBill: (body: any) => ops.post<Row>(`${U}/invoices`, body),
  approveBill: (id: string) => ops.post(`${U}/invoices/${id}/approve`),
  payBill: (id: string) => ops.post(`${U}/invoices/${id}/pay`),
  cancelBill: (id: string) => ops.post(`${U}/invoices/${id}/cancel`),
  refundBill: (id: string, body: { reason?: string; date?: string; lines?: { invoiceLineId: string; quantity: number }[]; post?: boolean }) =>
    ops.post(`${U}/invoices/${id}/refund`, body),

  // Returns
  returns: (params?: { supplierId?: string; billId?: string }) => ops.get<Row[]>(`${U}/returns`, params),
  createReturn: (body: any) => ops.post<Row>(`${U}/returns`, body),
  postReturn: (id: string) => ops.post(`${U}/returns/${id}/post`),
  cancelReturn: (id: string) => ops.post(`${U}/returns/${id}/cancel`),

  // Replenishment & settings
  replenishment: () => ops.get<Row[]>(`${U}/replenishment`),
  generateRfqs: (body: { warehouseId?: string; productIds?: string[] }) => ops.post<any>(`${U}/replenishment/generate`, body),
  settings: () => ops.get<any>(`${U}/settings`),
  updateSettings: (body: { poApprovalThreshold?: number; requisitionApprovalRequired?: boolean }) =>
    ops.put(`${U}/settings`, body),
};
