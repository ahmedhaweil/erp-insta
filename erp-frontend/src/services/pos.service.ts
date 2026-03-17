import api from '@/lib/api';
import type { PosSession, PosOrder, ApiResponse } from '@/types';

export const posService = {
  openSession: (data: { terminalId: string; openingCash: number }) =>
    api.post<ApiResponse<PosSession>>('/pos/sessions/open', data).then((r) => r.data.data),

  closeSession: (sessionId: string, data: { closingCash: number }) =>
    api.post<ApiResponse<PosSession>>(`/pos/sessions/${sessionId}/close`, data).then((r) => r.data.data),

  createOrder: (data: any) =>
    api.post<ApiResponse<PosOrder>>('/pos/orders', data).then((r) => r.data.data),

  getSessionOrders: (sessionId: string) =>
    api.get<ApiResponse<PosOrder[]>>(`/pos/sessions/${sessionId}/orders`).then((r) => r.data.data),
};
