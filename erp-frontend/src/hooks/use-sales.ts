'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { salesService } from '@/services/sales.service';
import { toast } from 'sonner';

export function useSalesOrders() {
  return useQuery({
    queryKey: ['sales-orders'],
    queryFn: () => salesService.getSalesOrders(),
  });
}

export function useSalesOrder(id: string) {
  return useQuery({
    queryKey: ['sales-orders', id],
    queryFn: () => salesService.getSalesOrder(id),
    enabled: !!id,
  });
}

export function useConfirmSalesOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => salesService.confirmSalesOrder(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales-orders'] });
      toast.success('Order confirmed');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to confirm order');
    },
  });
}

export function useCancelSalesOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => salesService.cancelSalesOrder(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales-orders'] });
      toast.success('Order cancelled');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to cancel order');
    },
  });
}

export function useSalesInvoices() {
  return useQuery({
    queryKey: ['sales-invoices'],
    queryFn: () => salesService.getSalesInvoices(),
  });
}

export function useSalesInvoice(id: string) {
  return useQuery({
    queryKey: ['sales-invoices', id],
    queryFn: () => salesService.getSalesInvoice(id),
    enabled: !!id,
  });
}

export function useMarkInvoicePaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => salesService.markInvoicePaid(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales-invoices'] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Invoice marked as paid');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to mark invoice as paid');
    },
  });
}
