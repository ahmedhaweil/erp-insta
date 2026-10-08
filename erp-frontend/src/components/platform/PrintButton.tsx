'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronDown, FileText, Printer } from 'lucide-react';
import { clsx } from 'clsx';
import { toast } from 'sonner';
import { openPdf } from '@/services/platform.service';

type Params = Record<string, string | number | boolean | undefined | null>;

function errorText(err: any, fallback: string) {
  const e = err?.response?.data?.error;
  return e?.message || err?.response?.data?.message || fallback;
}

const base =
  'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap';
const sizes = { sm: 'px-2.5 py-1 text-xs', md: 'px-4 py-2 text-sm' };
const variants = {
  secondary: 'bg-gray-100 text-gray-800 hover:bg-gray-200',
  ghost: 'text-primary-600 hover:bg-primary-50',
  danger: 'bg-red-600 text-white hover:bg-red-700',
};

/** Hook: opens a server PDF (in the UI language) in a new tab and toasts errors. */
export function usePdf() {
  const locale = useLocale();
  const t = useTranslations('platform');
  const [busy, setBusy] = useState(false);
  const open = async (path: string, params: Params = {}) => {
    setBusy(true);
    try {
      await openPdf(path, { lang: locale, ...params });
    } catch (err) {
      toast.error(errorText(err, t('print.failed')));
    } finally {
      setBusy(false);
    }
  };
  return { open, busy };
}

/**
 * "Print / PDF" button: fetches `path` (e.g. /print/sales-invoices/:id) with
 * the auth header and opens the PDF in a new tab. ?lang follows the UI.
 */
export function PrintButton({
  path,
  params,
  label,
  size = 'sm',
  variant = 'secondary',
  disabled,
  className,
}: {
  path: string;
  params?: Params;
  label?: string;
  size?: 'sm' | 'md';
  variant?: keyof typeof variants;
  disabled?: boolean;
  className?: string;
}) {
  const t = useTranslations('platform');
  const { open, busy } = usePdf();
  return (
    <button
      type="button"
      disabled={disabled || busy}
      onClick={(e) => {
        e.stopPropagation();
        open(path, params);
      }}
      className={clsx(base, sizes[size], variants[variant], className)}
    >
      <Printer size={size === 'sm' ? 13 : 16} />
      {busy ? t('print.opening') : label ?? t('print.print')}
    </button>
  );
}

/** Print button with several documents (e.g. quotation / order / delivery note). */
export function PrintMenu({
  items,
  size = 'sm',
  label,
}: {
  items: { label: string; path: string; params?: Params; hidden?: boolean }[];
  size?: 'sm' | 'md';
  label?: string;
}) {
  const t = useTranslations('platform');
  const { open, busy } = usePdf();
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!show) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setShow(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [show]);
  const visible = items.filter((i) => !i.hidden);
  if (!visible.length) return null;
  return (
    <div className="relative inline-block" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button type="button" disabled={busy} onClick={() => setShow((s) => !s)} className={clsx(base, sizes[size], variants.secondary)}>
        <Printer size={size === 'sm' ? 13 : 16} />
        {busy ? t('print.opening') : label ?? t('print.print')}
        <ChevronDown size={12} />
      </button>
      {show && (
        <div className="absolute z-30 mt-1 end-0 min-w-44 bg-white border border-gray-200 rounded-lg shadow-lg py-1">
          {visible.map((i) => (
            <button
              key={i.label}
              type="button"
              className="w-full text-start px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2 whitespace-nowrap"
              onClick={() => {
                setShow(false);
                open(i.path, i.params);
              }}
            >
              <FileText size={14} className="text-gray-400" />
              {i.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
