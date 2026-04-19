'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryService } from '@/services/inventory.service';
import { toast } from 'sonner';

export function useProducts() {
  return useQuery({
    queryKey: ['products'],
    queryFn: () => inventoryService.getProducts(),
  });
}

export function useProduct(id: string) {
  return useQuery({
    queryKey: ['products', id],
    queryFn: () => inventoryService.getProduct(id),
    enabled: !!id,
  });
}

export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => inventoryService.createProduct(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      toast.success('Product created successfully');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to create product');
    },
  });
}

export function useWarehouses() {
  return useQuery({
    queryKey: ['warehouses'],
    queryFn: () => inventoryService.getWarehouses(),
  });
}

export function useStock() {
  return useQuery({
    queryKey: ['stock'],
    queryFn: () => inventoryService.getStock(),
  });
}

export function useAdjustStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => inventoryService.adjustStock(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock'] });
      toast.success('Stock adjusted successfully');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to adjust stock');
    },
  });
}

export function useTransferStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => inventoryService.transferStock(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock'] });
      toast.success('Stock transferred successfully');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to transfer stock');
    },
  });
}

export function useUpdateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => inventoryService.updateProduct(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      toast.success('Product updated');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to update product');
    },
  });
}

export function useDeleteProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => inventoryService.deleteProduct(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      toast.success('Product deleted');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to delete product');
    },
  });
}

export function useCreateWarehouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => inventoryService.createWarehouse(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['warehouses'] });
      toast.success('Warehouse created');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to create warehouse');
    },
  });
}
