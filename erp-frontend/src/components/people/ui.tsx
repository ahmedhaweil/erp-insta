'use client';

import { clsx } from 'clsx';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ButtonHTMLAttributes } from 'react';

/* Small form/layout primitives shared by the HR, manufacturing and CRM screens. */

export const inputClass =
  'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-gray-100';

export function Field({ label, required, children, className, hint }: { label: string; required?: boolean; children: ReactNode; className?: string; hint?: string }) {
  return (
    <label className={clsx('block', className)}>
      <span className="block text-sm font-medium text-gray-700 mb-1">
        {label}
        {required && <span className="text-red-500 ms-0.5">*</span>}
      </span>
      {children}
      {hint && <span className="block text-xs text-gray-500 mt-1">{hint}</span>}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx(inputClass, props.className)} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={clsx(inputClass, props.className)} />;
}

export interface Option {
  value: string;
  label: string;
}

export function Select({ options, placeholder, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { options: Option[]; placeholder?: string }) {
  return (
    <select {...props} className={clsx(inputClass, props.className)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Checkbox({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="w-4 h-4 rounded border-gray-300" />
      {label}
    </label>
  );
}

type Variant = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost';
const variants: Record<Variant, string> = {
  primary: 'bg-primary-600 text-white hover:bg-primary-700',
  secondary: 'bg-gray-100 text-gray-800 hover:bg-gray-200',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  success: 'bg-green-600 text-white hover:bg-green-700',
  ghost: 'text-primary-600 hover:bg-primary-50',
};

export function Button({ variant = 'primary', className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...props}
      className={clsx('px-3 py-2 rounded-lg text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed', variants[variant], className)}
    />
  );
}

export function LinkButton({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props} className={clsx('text-sm hover:underline disabled:opacity-50', className)} />;
}

export function Card({ title, children, actions, className }: { title?: string; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={clsx('bg-white rounded-xl border border-gray-200', className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-b border-gray-200">
          {title && <h2 className="font-semibold text-gray-900">{title}</h2>}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string; count?: number }[]; value: T; onChange: (key: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-gray-200 mb-4">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onChange(tab.key)}
          className={clsx(
            'px-4 py-2 text-sm -mb-px border-b-2 transition',
            value === tab.key ? 'border-primary-600 text-primary-700 font-medium' : 'border-transparent text-gray-500 hover:text-gray-800',
          )}
        >
          {tab.label}
          {tab.count !== undefined && <span className="ms-1.5 px-1.5 rounded-full bg-gray-100 text-xs">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function ErrorBox({ message }: { message?: string | null }) {
  if (!message) return null;
  return <div className="p-3 mb-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 whitespace-pre-line">{message}</div>;
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-end gap-3 mb-4 bg-white border border-gray-200 rounded-xl p-4">{children}</div>;
}

export function FormActions({ onCancel, submitting, submitLabel }: { onCancel?: () => void; submitting?: boolean; submitLabel?: string }) {
  const tc = useTranslations('common');
  return (
    <div className="flex justify-end gap-3 pt-4">
      {onCancel && (
        <Button variant="secondary" onClick={onCancel} disabled={submitting}>
          {tc('cancel')}
        </Button>
      )}
      <Button type="submit" disabled={submitting}>
        {submitting ? tc('loading') : submitLabel || tc('save')}
      </Button>
    </div>
  );
}

export function KeyValue({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 text-sm">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-gray-500">{item.label}</dt>
          <dd className="font-medium text-gray-900">{item.value ?? '-'}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Number formatter following the UI locale (Latin digits for both). */
export function useMoney() {
  const locale = useLocale();
  return (value: unknown, digits = 2) => {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n)) return '-';
    return n.toLocaleString(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  };
}

export const num = (value: unknown, digits = 4) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? String(Math.round(n * 10 ** digits) / 10 ** digits) : '-';
};

export const todayIso = () => new Date().toISOString().slice(0, 10);
export const currentPeriod = () => new Date().toISOString().slice(0, 7);

export function SimpleTable({ headers, children, footer }: { headers: string[]; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="overflow-x-auto bg-white rounded-xl border border-gray-200">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            {headers.map((h, i) => (
              <th key={`${h}-${i}`} className="text-start px-3 py-2.5 font-medium text-gray-600 whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">{children}</tbody>
        {footer && <tfoot className="bg-gray-50 font-semibold border-t border-gray-200">{footer}</tfoot>}
      </table>
    </div>
  );
}

export const td = 'px-3 py-2 text-gray-900 whitespace-nowrap';
