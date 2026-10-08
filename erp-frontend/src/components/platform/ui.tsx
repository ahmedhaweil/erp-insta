'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

/** Small helpers shared by the approvals, import and alerts screens. */

export function errorMessage(err: any, fallback: string): string {
  const e = err?.response?.data?.error;
  if (e) {
    const details: string[] = Array.isArray(e.details) ? e.details.map((d: any) => (typeof d === 'string' ? d : d?.message)).filter(Boolean) : [];
    return details.length ? `${e.message}: ${details.join(', ')}` : e.message || fallback;
  }
  return err?.response?.data?.message || fallback;
}

/** Mutation with toasts that refreshes the given query keys. */
export function usePlatformMutation<TArg, TRes = unknown>(
  fn: (arg: TArg) => Promise<TRes>,
  options: { invalidate?: string[]; success?: string | false; onSuccess?: (res: TRes, arg: TArg) => void } = {},
) {
  const qc = useQueryClient();
  const t = useTranslations('platform');
  return useMutation({
    mutationFn: fn,
    onSuccess: (res, arg) => {
      (options.invalidate ?? []).forEach((key) => qc.invalidateQueries({ queryKey: [key] }));
      if (options.success !== false) toast.success(options.success ?? t('common.saved'));
      options.onSuccess?.(res, arg);
    },
    onError: (err) => {
      toast.error(errorMessage(err, t('common.failed')));
    },
  });
}

export function fmtDateTime(v: unknown): string {
  if (!v) return '-';
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  return `${d.toISOString().slice(0, 10)} ${d.toTimeString().slice(0, 5)}`;
}

export function fmtAmount(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-';
}
