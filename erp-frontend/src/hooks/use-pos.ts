'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { posService } from '@/services/pos.service';
import { toast } from 'sonner';

export function useSessionOrders(sessionId: string) {
  return useQuery({
    queryKey: ['pos-orders', sessionId],
    queryFn: () => posService.getSessionOrders(sessionId),
    enabled: !!sessionId,
  });
}

export function useOpenSession() {
  return useMutation({
    mutationFn: (data: { terminalId: string; openingCash: number }) =>
      posService.openSession(data),
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to open session');
    },
  });
}

export function useCloseSession() {
  return useMutation({
    mutationFn: ({ sessionId, data }: { sessionId: string; data: { closingCash: number } }) =>
      posService.closeSession(sessionId, data),
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to close session');
    },
  });
}

export function useCreatePosOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => posService.createOrder(data),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ['pos-orders', variables.sessionId] });
      toast.success('Sale completed');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to complete sale');
    },
  });
}
