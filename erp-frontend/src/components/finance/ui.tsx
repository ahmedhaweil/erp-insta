'use client';

import { clsx } from 'clsx';
import { useLocale } from 'next-intl';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

/** Small building blocks shared by the finance, treasury, reports and admin screens. */

export const inputCls =
  'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-gray-100';

export function Field({
  label,
  error,
  hint,
  className,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
      {hint && !error && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';

const variants: Record<Variant, string> = {
  primary: 'bg-primary-600 text-white hover:bg-primary-700',
  secondary: 'bg-gray-100 text-gray-700 hover:bg-gray-200',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  success: 'bg-green-600 text-white hover:bg-green-700',
  ghost: 'text-primary-600 hover:bg-primary-50',
};

export function Btn({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      {...props}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:opacity-50 disabled:cursor-not-allowed',
        size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-4 py-2 text-sm',
        variants[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Card({
  title,
  actions,
  className,
  children,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={clsx('bg-white rounded-xl border border-gray-200', className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-b border-gray-200">
          {title && <h2 className="text-base font-semibold text-gray-900">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-gray-200 mb-4">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onChange(tab.key)}
          className={clsx(
            'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition',
            value === tab.key
              ? 'border-primary-600 text-primary-700'
              : 'border-transparent text-gray-500 hover:text-gray-800',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex justify-center p-8">
      <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-end gap-3 mb-4">{children}</div>;
}

export function KeyValue({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {items.map((it, i) => (
        <div key={i} className="bg-gray-50 rounded-lg p-3">
          <dt className="text-xs text-gray-500">{it.label}</dt>
          <dd className="text-sm font-semibold text-gray-900 mt-0.5">{it.value ?? '-'}</dd>
        </div>
      ))}
    </dl>
  );
}

// ------------------------------------------------------------------ formatting

const moneyFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });

/** Money with thousands separators; negatives in parentheses-free minus form. */
export function fmtMoney(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  return Number.isFinite(n) ? moneyFmt.format(n) : String(value);
}

export function fmtNum(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  return Number.isFinite(n) ? numFmt.format(n) : String(value);
}

export function fmtDate(value: unknown): string {
  if (!value) return '';
  const s = String(value);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

export function fmtDateTime(value: unknown): string {
  if (!value) return '';
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return `${d.toISOString().slice(0, 10)} ${d.toTimeString().slice(0, 5)}`;
}

export function Money({ value, className }: { value: unknown; className?: string }) {
  const n = Number(value);
  return (
    <span className={clsx('tabular-nums whitespace-nowrap', n < 0 && 'text-red-600', className)} dir="ltr">
      {fmtMoney(value)}
    </span>
  );
}

/** Localised name of a record that has nameAr / nameEn. */
export function useLocalName() {
  const locale = useLocale();
  return (item?: { nameAr?: string | null; nameEn?: string | null; name?: string | null } | null) => {
    if (!item) return '';
    if (locale === 'ar') return item.nameAr || item.nameEn || item.name || '';
    return item.nameEn || item.nameAr || item.name || '';
  };
}

export const todayIso = () => new Date().toISOString().slice(0, 10);

export function firstOfMonthIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export function firstOfYearIso() {
  return `${new Date().getFullYear()}-01-01`;
}

/** Extracts the server error message from an axios error. */
export function apiError(err: any, fallback: string): string {
  const data = err?.response?.data;
  const details = data?.error?.details;
  if (Array.isArray(details) && details.length) {
    return details.map((d: any) => d.message).join(' - ');
  }
  return data?.error?.message || data?.message || fallback;
}
