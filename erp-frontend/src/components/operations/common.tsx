'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { clsx } from 'clsx';
import StatusBadge from '@/components/ui/StatusBadge';
import Modal from '@/components/ui/Modal';
import { Btn, Field, inputCls } from './form';

/** Open/close state of a modal that optionally carries a record. */
export function useModal<T = any>() {
  const [state, setState] = useState<{ open: boolean; data: T | null }>({ open: false, data: null });
  return {
    isOpen: state.open,
    data: state.data,
    open: (data?: T | null) => setState({ open: true, data: data ?? null }),
    close: () => setState({ open: false, data: null }),
  };
}

/** Today's date as YYYY-MM-DD (local time). */
export function today(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function fmtMoney(v: unknown): string {
  return num(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtQty(v: unknown): string {
  return num(v).toLocaleString('en-US', { maximumFractionDigits: 4 });
}

export function fmtDate(v: unknown): string {
  if (!v) return '-';
  const s = String(v);
  return s.length > 10 ? s.slice(0, 10) : s;
}

export function fmtDateTime(v: unknown): string {
  if (!v) return '-';
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
}

/** Returns a function that picks the localized name of a record (nameAr / nameEn / name). */
export function useNamer() {
  const locale = useLocale();
  return (row: any): string => {
    if (!row) return '-';
    const primary = locale === 'ar' ? row.nameAr : row.nameEn;
    const secondary = locale === 'ar' ? row.nameEn : row.nameAr;
    return primary || secondary || row.name || row.code || '-';
  };
}

/** Builds an id -> record map for lookups in table cells. */
export function byId<T extends { id: string }>(rows: T[] | undefined): Record<string, T> {
  const map: Record<string, T> = {};
  (rows ?? []).forEach((r) => (map[r.id] = r));
  return map;
}

/** Status badge with a translated label (ops.status.<value>). */
export function Status({ status }: { status?: string | null }) {
  const t = useTranslations('ops.status');
  if (!status) return <span>-</span>;
  const label = t.has(status) ? t(status) : status;
  return <StatusBadge status={status} label={label} />;
}

export function Card({
  title,
  actions,
  children,
  className,
}: {
  title?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx('bg-white rounded-xl border border-gray-200', className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-gray-200">
          {title && <h3 className="font-semibold text-gray-900">{title}</h3>}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      <div className="p-4">{children}</div>
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
            'px-4 py-2 text-sm -mb-px border-b-2 transition',
            value === tab.key
              ? 'border-primary-600 text-primary-700 font-medium'
              : 'border-transparent text-gray-500 hover:text-gray-800',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function FilterBar({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-end gap-3 mb-4">{children}</div>;
}

export function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'green' | 'red' | 'amber' }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div
        className={clsx(
          'text-lg font-semibold mt-0.5',
          tone === 'green' && 'text-green-700',
          tone === 'red' && 'text-red-700',
          tone === 'amber' && 'text-amber-700',
        )}
      >
        {value}
      </div>
    </div>
  );
}

/** Small inline action button used in table rows. */
export function RowAction({
  onClick,
  children,
  tone = 'primary',
  disabled,
}: {
  onClick: () => void;
  children: React.ReactNode;
  tone?: 'primary' | 'green' | 'red' | 'amber' | 'gray';
  disabled?: boolean;
}) {
  const color = {
    primary: 'text-primary-600',
    green: 'text-green-700',
    red: 'text-red-600',
    amber: 'text-amber-600',
    gray: 'text-gray-600',
  }[tone];
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={clsx('text-sm hover:underline disabled:opacity-40 whitespace-nowrap', color)}
    >
      {children}
    </button>
  );
}

export function RowActions({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1" onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  );
}

/** Modal asking for one value (a reason, an amount...) instead of window.prompt. */
export function PromptModal({
  isOpen,
  title,
  label,
  type = 'text',
  initial = '',
  required = true,
  loading,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  title: string;
  label: string;
  type?: 'text' | 'number' | 'date';
  initial?: string;
  required?: boolean;
  loading?: boolean;
  onClose: () => void;
  onSubmit: (value: string) => void;
}) {
  const t = useTranslations('ops');
  const [value, setValue] = useState(initial);
  const [lastInitial, setLastInitial] = useState(initial);
  if (initial !== lastInitial) {
    setLastInitial(initial);
    setValue(initial);
  }
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (required && !value.trim()) return;
          onSubmit(value);
        }}
        className="space-y-4"
      >
        <Field label={label}>
          <input
            autoFocus
            type={type}
            step="any"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className={inputCls}
            required={required}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Btn variant="secondary" type="button" onClick={onClose}>
            {t('common.cancel')}
          </Btn>
          <Btn type="submit" loading={loading}>
            {t('common.confirm')}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}

/** A simple key/value grid for detail views. */
export function DetailGrid({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3 text-sm">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-gray-500">{item.label}</dt>
          <dd className="font-medium text-gray-900 break-words">{item.value ?? '-'}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Plain table for small embedded lists (lines, schedules...). */
export function SimpleTable({
  columns,
  rows,
  empty,
  footer,
}: {
  columns: { key: string; header: string; render?: (row: any, index: number) => React.ReactNode; className?: string }[];
  rows: any[];
  empty?: string;
  footer?: React.ReactNode;
}) {
  const t = useTranslations('ops');
  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            {columns.map((c) => (
              <th key={c.key} className={clsx('text-start px-3 py-2 font-medium text-gray-600', c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-6 text-center text-gray-500">
                {empty ?? t('common.noData')}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr key={row.id ?? i} className="border-b border-gray-100 last:border-0">
                {columns.map((c) => (
                  <td key={c.key} className={clsx('px-3 py-2 text-gray-900', c.className)}>
                    {c.render ? c.render(row, i) : row[c.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
        {footer}
      </table>
    </div>
  );
}
