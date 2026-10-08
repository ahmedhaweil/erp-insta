'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { apiError } from '@/components/finance/ui';
import { adminService } from '@/services/finance-admin.service';
import { finAccountingService } from '@/services/finance-accounting.service';
import { treasuryService } from '@/services/finance-treasury.service';

/**
 * Shared hooks of the finance area: a mutation wrapper with translated toasts
 * and the lookup lists (accounts, treasuries, branches, partners...) used by
 * pickers on many screens.
 */
export function useFinAction<TArg, TRes = unknown>(
  action: (arg: TArg) => Promise<TRes>,
  options: { invalidate: string[]; success?: string; onSuccess?: (res: TRes) => void },
) {
  const qc = useQueryClient();
  const t = useTranslations('fin');
  return useMutation({
    mutationFn: action,
    onSuccess: (res) => {
      options.invalidate.forEach((key) => qc.invalidateQueries({ queryKey: [key] }));
      toast.success(options.success ?? t('saved'));
      options.onSuccess?.(res);
    },
    onError: (err: any) => {
      toast.error(apiError(err, t('failed')));
    },
  });
}

export const useFinAccounts = () =>
  useQuery({ queryKey: ['fin-accounts'], queryFn: finAccountingService.getAccounts, staleTime: 60_000 });

export const useTreasuries = (withBalance = true) =>
  useQuery({
    queryKey: ['treasuries', withBalance],
    queryFn: () => treasuryService.getTreasuries({ withBalance }),
  });

export const useBranches = () => useQuery({ queryKey: ['branches'], queryFn: adminService.getBranches, staleTime: 60_000 });

export const useFiscalYears = () =>
  useQuery({ queryKey: ['fiscal-years'], queryFn: finAccountingService.getFiscalYears });

export const useCustomersLookup = () =>
  useQuery({ queryKey: ['fin-customers'], queryFn: treasuryService.getCustomers, staleTime: 60_000 });

export const useSuppliersLookup = () =>
  useQuery({ queryKey: ['fin-suppliers'], queryFn: treasuryService.getSuppliers, staleTime: 60_000 });

export const useJournals = () =>
  useQuery({ queryKey: ['fin-journals'], queryFn: finAccountingService.getJournals, staleTime: 60_000 });

export const useCostCenters = () =>
  useQuery({ queryKey: ['fin-cost-centers'], queryFn: finAccountingService.getCostCenters, staleTime: 60_000 });

export const useCurrencies = () =>
  useQuery({ queryKey: ['fin-currencies'], queryFn: finAccountingService.getCurrencies, staleTime: 300_000 });

export const useExchangeRates = () =>
  useQuery({ queryKey: ['fin-exchange-rates'], queryFn: () => finAccountingService.getExchangeRates(), staleTime: 60_000 });

/**
 * Latest exchange rate of a currency on or before a date (company rates win
 * over the shared defaults on the same date). Undefined when none is known.
 */
export function useRateFor(currencyId: string | null | undefined, date: string): number | undefined {
  const { data: rates = [] } = useExchangeRates();
  if (!currencyId) return undefined;
  const best = rates
    .filter((r) => r.currencyId === currencyId && String(r.date).slice(0, 10) <= (date || '9999-12-31'))
    .sort((a, b) => {
      const byDate = String(b.date).localeCompare(String(a.date));
      if (byDate) return byDate;
      return (a.tenantId ? 0 : 1) - (b.tenantId ? 0 : 1);
    })[0];
  return best ? Number(best.rate) : undefined;
}

export const useUsersLookup = () => useQuery({ queryKey: ['users'], queryFn: adminService.getUsers, staleTime: 60_000 });

/** id -> record map helper. */
export function byId<T extends { id: string }>(rows: T[] | undefined): Record<string, T> {
  const out: Record<string, T> = {};
  for (const r of rows ?? []) out[r.id] = r;
  return out;
}
