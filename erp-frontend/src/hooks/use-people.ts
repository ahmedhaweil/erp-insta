'use client';

import { useCallback } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { hrService } from '@/services/people-hr.service';
import { crmService } from '@/services/people-crm.service';
import { lookupsService } from '@/services/people-lookups.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Extracts the backend message ({success:false,error:{message,details}}) of an axios error. */
export function apiErrorMessage(err: any, fallback: string): string {
  const error = err?.response?.data?.error;
  if (error) {
    const details: string[] = Array.isArray(error.details)
      ? error.details.map((d: any) => (typeof d === 'string' ? d : d?.message)).filter(Boolean)
      : [];
    return details.length ? `${error.message}: ${details.join(', ')}` : error.message || fallback;
  }
  const message = err?.response?.data?.message;
  if (Array.isArray(message)) return message.join(', ');
  return message || fallback;
}

export function usePeopleQuery<T>(key: unknown[], fn: () => Promise<T>, enabled = true) {
  return useQuery({ queryKey: key, queryFn: fn, enabled });
}

/**
 * Mutation that refreshes the given query keys and toasts the outcome. The
 * error message of the backend (including validation details) is shown.
 */
export function usePeopleMutation<TArg, TResult = unknown>(
  fn: (arg: TArg) => Promise<TResult>,
  options: { invalidate?: string[]; success?: string; onSuccess?: (result: TResult, arg: TArg) => void } = {},
) {
  const qc = useQueryClient();
  const tc = useTranslations('common');
  return useMutation({
    mutationFn: fn,
    onSuccess: (result, arg) => {
      (options.invalidate ?? []).forEach((key) => qc.invalidateQueries({ queryKey: [key] }));
      toast.success(options.success ?? tc('success'));
      options.onSuccess?.(result, arg);
    },
    onError: (err: any) => {
      if (err?.approvalHandled) return;
      toast.error(apiErrorMessage(err, tc('error')));
    },
  });
}

/** Localised display name of a record with name/nameEn/nameAr fields. */
export function useLocalName() {
  const locale = useLocale();
  return useCallback(
    (item?: { name?: string | null; nameEn?: string | null; nameAr?: string | null } | null) => {
      if (!item) return '';
      const en = item.nameEn || item.name || '';
      return locale === 'ar' ? item.nameAr || en : en || item.nameAr || '';
    },
    [locale],
  );
}

// ------------------------------------------------------------- lookups
export const useEmployeesLookup = (status?: string) =>
  usePeopleQuery(['hr-employees', 'lookup', status ?? 'all'], () => hrService.employees({ status }));
export const useDepartments = () => usePeopleQuery(['hr-departments'], hrService.departments);
export const useJobTitles = () => usePeopleQuery(['hr-job-titles'], hrService.jobTitles);
export const useSchedules = () => usePeopleQuery(['hr-work-schedules'], hrService.schedules);
export const useLeaveTypes = () => usePeopleQuery(['hr-leave-types'], hrService.leaveTypes);
export const useBranches = () => usePeopleQuery(['people-branches'], lookupsService.branches);
export const useUsers = () => usePeopleQuery(['people-users'], lookupsService.users);
export const useProducts = () => usePeopleQuery(['people-products'], lookupsService.products);
export const useWarehouses = () => usePeopleQuery(['people-warehouses'], lookupsService.warehouses);
export const useCustomers = () => usePeopleQuery(['people-customers'], lookupsService.customers);
export const useCrmStages = (includeInactive = false) =>
  usePeopleQuery(['crm-stages', includeInactive], () => crmService.stages(includeInactive));

/** Builds an id -> label map for a lookup list. */
export function useLabelMap<T extends { id: string; code?: string }>(items: T[] | undefined, withCode = true) {
  const name = useLocalName();
  const map = new Map<string, string>();
  for (const item of items ?? []) {
    const label = name(item as any);
    map.set(item.id, withCode && item.code ? `${item.code} - ${label}` : label);
  }
  return map;
}
