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

export function useSupplier(id: string) {
  return useQuery({
    queryKey: ['suppliers', id],
    queryFn: () => purchasingService.getSupplier(id),
    enabled: !!id,
  });
}

export function usePurchaseOrder(id: string) {
  return useQuery({
    queryKey: ['purchase-orders', id],
    queryFn: () => purchasingService.getPurchaseOrder(id),
    enabled: !!id,
  });
}

export function usePurchaseInvoice(id: string) {
  return useQuery({
    queryKey: ['purchase-invoices', id],
    queryFn: () => purchasingService.getPurchaseInvoice(id),
    enabled: !!id,
  });
}

export function useUpdateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => purchasingService.updateSupplier(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success('Supplier updated');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to update supplier');
    },
  });
}

export function useDeleteSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => purchasingService.deleteSupplier(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success('Supplier deleted');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to delete supplier');
    },
  });
}

export function useCancelPurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => purchasingService.cancelPurchaseOrder(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      toast.success('Purchase order cancelled');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to cancel order');
    },
  });
}
