import { ops, type Row } from './operations-api';

const S = '/sales';

export const opsSales = {
  // Customers & categories
  customers: () => ops.get<Row[]>(`${S}/customers`),
  createCustomer: (body: any) => ops.post<Row>(`${S}/customers`, body),
  updateCustomer: (id: string, body: any) => ops.patch<Row>(`${S}/customers/${id}`, body),
  deleteCustomer: (id: string) => ops.del(`${S}/customers/${id}`),
  customerCategories: () => ops.get<Row[]>(`${S}/customer-categories`),
  createCustomerCategory: (body: any) => ops.post<Row>(`${S}/customer-categories`, body),
  updateCustomerCategory: (id: string, body: any) => ops.patch<Row>(`${S}/customer-categories/${id}`, body),

  // Price lists
  priceLists: () => ops.get<Row[]>(`${S}/price-lists`),
  priceList: (id: string) => ops.get<Row>(`${S}/price-lists/${id}`),
  createPriceList: (body: any) => ops.post<Row>(`${S}/price-lists`, body),
  updatePriceList: (id: string, body: any) => ops.patch<Row>(`${S}/price-lists/${id}`, body),
  addPriceRule: (id: string, body: any) => ops.post<Row>(`${S}/price-lists/${id}/rules`, body),
  deletePriceRule: (id: string, ruleId: string) => ops.del(`${S}/price-lists/${id}/rules/${ruleId}`),
  price: (params: { productId: string; customerId?: string; quantity?: number; date?: string; priceListId?: string }) =>
    ops.get<any>(`${S}/pricing/price`, params),
  setMinPrice: (productId: string, minSellPrice: number | null) =>
    ops.patch(`${S}/pricing/products/${productId}/min-price`, { minSellPrice }),

  // Sales reps & commissions
  reps: () => ops.get<Row[]>(`${S}/reps`),
  createRep: (body: any) => ops.post<Row>(`${S}/reps`, body),
  updateRep: (id: string, body: any) => ops.patch<Row>(`${S}/reps/${id}`, body),
  commissionRules: (salesRepId?: string) => ops.get<Row[]>(`${S}/commission-rules`, { salesRepId }),
  createCommissionRule: (body: any) => ops.post<Row>(`${S}/commission-rules`, body),
  updateCommissionRule: (id: string, body: any) => ops.patch<Row>(`${S}/commission-rules/${id}`, body),
  commissionPreview: (params: { salesRepId: string; periodFrom: string; periodTo: string }) =>
    ops.get<any>(`${S}/commission-statements/preview`, params),
  commissionStatements: (salesRepId?: string) => ops.get<Row[]>(`${S}/commission-statements`, { salesRepId }),
  createCommissionStatement: (body: any) => ops.post<Row>(`${S}/commission-statements`, body),
  postCommissionStatement: (id: string, body?: { date?: string }) => ops.post(`${S}/commission-statements/${id}/post`, body),
  cancelCommissionStatement: (id: string) => ops.post(`${S}/commission-statements/${id}/cancel`),

  // Orders (quotations)
  orders: () => ops.get<Row[]>(`${S}/orders`),
  order: (id: string) => ops.get<Row>(`${S}/orders/${id}`),
  createOrder: (body: any) => ops.post<Row>(`${S}/orders`, body),
  sendOrder: (id: string) => ops.post(`${S}/orders/${id}/send`),
  confirmOrder: (id: string) => ops.post(`${S}/orders/${id}/confirm`),
  cancelOrder: (id: string) => ops.post(`${S}/orders/${id}/cancel`),
  deliverOrder: (id: string, body: { warehouseId?: string; lines?: { lineId: string; quantity: number }[]; date?: string }) =>
    ops.post(`${S}/orders/${id}/deliver`, body),
  invoiceOrder: (id: string, body: { policy?: 'ordered' | 'delivered'; date?: string; post?: boolean }) =>
    ops.post<Row>(`${S}/orders/${id}/invoice`, body),

  // Invoices
  invoices: () => ops.get<Row[]>(`${S}/invoices`),
  invoice: (id: string) => ops.get<Row>(`${S}/invoices/${id}`),
  createInvoice: (body: any) => ops.post<Row>(`${S}/invoices`, body),
  postInvoice: (id: string) => ops.post(`${S}/invoices/${id}/post`),
  payInvoice: (id: string) => ops.post(`${S}/invoices/${id}/pay`),
  cancelInvoice: (id: string) => ops.post(`${S}/invoices/${id}/cancel`),
  creditNote: (id: string, body: { reason?: string; date?: string; lines?: { invoiceLineId: string; quantity: number }[]; post?: boolean }) =>
    ops.post<Row>(`${S}/invoices/${id}/credit-note`, body),
  /** Register-payment shortcut: a customer receipt allocated to one invoice (payments module). */
  registerPayment: (body: { partnerId: string; invoiceId: string; amount: number; date: string; method?: string; reference?: string }) =>
    ops.post('/payments', {
      partnerType: 'customer',
      partnerId: body.partnerId,
      amount: body.amount,
      date: body.date,
      method: body.method,
      reference: body.reference || undefined,
      allocations: [{ invoiceId: body.invoiceId, amount: body.amount }],
    }),

  // Returns
  returns: (params?: { customerId?: string; invoiceId?: string }) => ops.get<Row[]>(`${S}/returns`, params),
  salesReturn: (id: string) => ops.get<Row>(`${S}/returns/${id}`),
  createReturn: (body: any) => ops.post<Row>(`${S}/returns`, body),
  postReturn: (id: string) => ops.post(`${S}/returns/${id}/post`),
  cancelReturn: (id: string) => ops.post(`${S}/returns/${id}/cancel`),

  // Installments
  installmentPlans: (params?: { customerId?: string; invoiceId?: string; status?: string }) =>
    ops.get<Row[]>(`${S}/installment-plans`, params),
  installmentPlan: (id: string) => ops.get<Row>(`${S}/installment-plans/${id}`),
  createInstallmentPlan: (body: any) => ops.post<Row>(`${S}/installment-plans`, body),
  recomputePlan: (id: string) => ops.post(`${S}/installment-plans/${id}/recompute`),
  cancelPlan: (id: string) => ops.post(`${S}/installment-plans/${id}/cancel`),
  dueInstallments: (params?: { asOf?: string; dueTo?: string; status?: string; customerId?: string }) =>
    ops.get<any>(`${S}/installments/due`, params),
  installmentStatement: (customerId: string, asOf?: string) =>
    ops.get<any>(`${S}/customers/${customerId}/installment-statement`, { asOf }),
};
