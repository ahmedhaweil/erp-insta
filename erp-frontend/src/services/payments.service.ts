import api from '@/lib/api';
import type { ApiResponse, Payment, CreatePaymentInput } from '@/types';

export const paymentsService = {
  getPayments: (partnerId?: string) =>
    api
      .get<ApiResponse<Payment[]>>('/payments', { params: partnerId ? { partnerId } : undefined })
      .then((r) => r.data.data),

  createPayment: (data: CreatePaymentInput) =>
    api.post<ApiResponse<Payment>>('/payments', data).then((r) => r.data.data),

  allocatePayment: (id: string, allocations: { invoiceId: string; amount: number }[]) =>
    api.post<ApiResponse<Payment>>(`/payments/${id}/allocate`, { allocations }).then((r) => r.data.data),

  cancelPayment: (id: string) =>
    api.post<ApiResponse<Payment>>(`/payments/${id}/cancel`).then((r) => r.data.data),
};
