import { ops, type Row } from './operations-api';

export interface PosOrderInput {
  sessionId: string;
  customerId?: string;
  clientReference: string;
  paymentMethod: 'cash' | 'card' | 'split';
  cashReceived?: number;
  cashAmount?: number;
  lines: { productId: string; quantity: number; unitPrice?: number; discount?: number; taxRate?: number }[];
}

export const opsPos = {
  terminals: () => ops.get<Row[]>('/pos/terminals'),
  createTerminal: (body: any) => ops.post<Row>('/pos/terminals', body),
  updateTerminal: (id: string, body: any) => ops.patch<Row>(`/pos/terminals/${id}`, body),

  openSession: (body: { terminalId: string; openingCash?: number }) => ops.post<Row>('/pos/sessions/open', body),
  closeSession: (id: string, closingCash: number) => ops.post<Row>(`/pos/sessions/${id}/close`, { closingCash }),
  summary: (id: string) => ops.get<any>(`/pos/sessions/${id}/summary`),
  sessionOrders: (id: string) => ops.get<Row[]>(`/pos/sessions/${id}/orders`),
  cashMovements: (id: string) => ops.get<Row[]>(`/pos/sessions/${id}/cash-movements`),
  addCashMovement: (id: string, body: { type: 'in' | 'out'; amount: number; reason: string }) =>
    ops.post(`/pos/sessions/${id}/cash-movements`, body),

  createOrder: (body: PosOrderInput) => ops.post<Row>('/pos/orders', body),
  refund: (orderId: string, body: { sessionId: string; lines?: { productId: string; quantity: number }[] }) =>
    ops.post<Row>(`/pos/orders/${orderId}/refund`, body),
};
