'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { purchasingService } from '@/services/purchasing.service';
import { toast } from 'sonner';

export function useSuppliers() {
  return useQuery({
    queryKey: ['suppliers'],
    queryFn: () => purchasingService.getSuppliers(),
  });
}

export function useCreateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => purchasingService.createSupplier(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success('Supplier created successfully');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to create supplier');
    },
  });
}

export function usePurchaseOrders() {
  return useQuery({
    queryKey: ['purchase-orders'],
    queryFn: () => purchasingService.getPurchaseOrders(),
  });
}

export function useConfirmPurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => purchasingService.confirmPurchaseOrder(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      toast.success('Purchase order confirmed');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to confirm order');
    },
  });
}

export function usePurchaseInvoices() {
  return useQuery({
    queryKey: ['purchase-invoices'],
    queryFn: () => purchasingService.getPurchaseInvoices(),
  });
}

export function useApprovePurchaseInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => purchasingService.approvePurchaseInvoice(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-invoices'] });
      toast.success('Invoice approved');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to approve invoice');
    },
  });
}

export function useMarkPurchaseInvoicePaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => purchasingService.markPurchaseInvoicePaid(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-invoices'] });
      toast.success('Invoice marked as paid');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to mark invoice as paid');
    },
  });
}
