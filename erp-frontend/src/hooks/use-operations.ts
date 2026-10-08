'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { apiError } from '@/services/operations-api';
import { opsInventory, opsBranches } from '@/services/operations-inventory.service';
import { opsSales } from '@/services/operations-sales.service';
import { opsPurchasing } from '@/services/operations-purchasing.service';
import { opsPos } from '@/services/operations-pos.service';

/** react-query wrapper for the operations screens; keys are prefixed with "ops". */
export function useOpsQuery<T>(key: unknown[], fn: () => Promise<T>, options?: { enabled?: boolean }) {
  return useQuery({ queryKey: ['ops', ...key], queryFn: fn, enabled: options?.enabled ?? true });
}

/**
 * Mutation that toasts a translated success message (ops.msg.<success>, default "saved")
 * or the API error, and refreshes the given query key prefixes (each under "ops").
 */
export function useOpsMutation<TArg, TResult = unknown>(
  fn: (arg: TArg) => Promise<TResult>,
  options: { invalidate?: string[]; success?: string | false; onSuccess?: (result: TResult, arg: TArg) => void } = {},
) {
  const qc = useQueryClient();
  const t = useTranslations('ops');
  return useMutation({
    mutationFn: fn,
    onSuccess: (result, arg) => {
      (options.invalidate ?? []).forEach((key) => qc.invalidateQueries({ queryKey: ['ops', key] }));
      if (options.success !== false) toast.success(t(`msg.${options.success ?? 'saved'}`));
      options.onSuccess?.(result, arg);
    },
    onError: (err: any) => {
      if (err?.approvalHandled) return;
      toast.error(apiError(err, t('msg.error')));
    },
  });
}

// Shared lookup lists used by many screens
export const useOpsProducts = () => useOpsQuery(['products'], opsInventory.products);
export const useOpsWarehouses = () => useOpsQuery(['warehouses'], opsInventory.warehouses);
export const useOpsCategories = () => useOpsQuery(['categories'], opsInventory.categories);
export const useOpsUnits = () => useOpsQuery(['units'], opsInventory.units);
export const useOpsBranches = () => useOpsQuery(['branches'], opsBranches);
export const useOpsCustomers = () => useOpsQuery(['customers'], opsSales.customers);
export const useOpsCustomerCategories = () => useOpsQuery(['customer-categories'], opsSales.customerCategories);
export const useOpsPriceLists = () => useOpsQuery(['price-lists'], opsSales.priceLists);
export const useOpsReps = () => useOpsQuery(['reps'], opsSales.reps);
export const useOpsSuppliers = () => useOpsQuery(['suppliers'], opsPurchasing.suppliers);
export const useOpsTerminals = () => useOpsQuery(['terminals'], opsPos.terminals);
