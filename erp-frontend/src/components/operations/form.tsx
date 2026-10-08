'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { clsx } from 'clsx';

export const inputCls =
  'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-gray-100';

/** Same look as inputCls without the full width, for inputs sized with a w-* class. */
export const inputSm = inputCls.replace('w-full ', '');

export function Field({
  label,
  children,
  hint,
  className,
  required,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  className?: string;
  required?: boolean;
}) {
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

type BtnVariant = 'primary' | 'secondary' | 'danger' | 'success' | 'warning';

export function Btn({
  variant = 'primary',
  loading,
  className,
  children,
  size = 'md',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; loading?: boolean; size?: 'sm' | 'md' | 'lg' }) {
  const t = useTranslations('ops');
  const colors: Record<BtnVariant, string> = {
    primary: 'bg-primary-600 hover:bg-primary-700 text-white',
    secondary: 'bg-gray-100 hover:bg-gray-200 text-gray-800',
    danger: 'bg-red-600 hover:bg-red-700 text-white',
    success: 'bg-green-600 hover:bg-green-700 text-white',
    warning: 'bg-amber-500 hover:bg-amber-600 text-white',
  };
  const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm', lg: 'px-5 py-3 text-base' };
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || loading}
      className={clsx(
        'rounded-lg font-medium transition disabled:opacity-50 disabled:cursor-not-allowed',
        colors[variant],
        sizes[size],
        className,
      )}
    >
      {loading ? t('common.loading') : children}
    </button>
  );
}

/** Native select bound to a string value with an optional empty option. */
export function SelectBox({
  value,
  onChange,
  options,
  emptyLabel,
  required,
  className,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  emptyLabel?: string | false;
  required?: boolean;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={clsx(inputCls, className)}
      required={required}
      disabled={disabled}
    >
      {emptyLabel !== false && <option value="">{emptyLabel ?? '-'}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Rows -> select options labelled "code - name" (or just the name). */
export function toOptions(rows: any[] | undefined, label: (row: any) => string, withCode = true) {
  return (rows ?? []).map((r) => ({
    value: r.id as string,
    label: withCode && r.code ? `${r.code} - ${label(r)}` : label(r),
  }));
}

export interface FieldDef {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'select' | 'checkbox' | 'date' | 'textarea' | 'email' | 'password';
  options?: { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
  hint?: string;
  /** Full-width field in the two-column grid. */
  wide?: boolean;
  min?: number;
  max?: number;
  step?: string;
  /** Label of the empty option of a select (defaults to "-"). */
  emptyLabel?: string;
  hidden?: boolean;
}

type Values = Record<string, any>;

function toInitial(fields: FieldDef[], initial?: Values): Values {
  const out: Values = {};
  for (const f of fields) {
    const v = initial?.[f.name];
    if (f.type === 'checkbox') out[f.name] = v ?? false;
    else out[f.name] = v === null || v === undefined ? '' : String(v);
  }
  return out;
}

/**
 * Converts the raw form state to an API payload. On create, empty values are
 * omitted; on edit they are sent as null so the field is cleared.
 */
export function buildPayload(fields: FieldDef[], values: Values, mode: 'create' | 'edit'): Values {
  const out: Values = {};
  for (const f of fields) {
    if (f.hidden) continue;
    const v = values[f.name];
    if (f.type === 'checkbox') {
      out[f.name] = !!v;
      continue;
    }
    if (v === '' || v === undefined || v === null) {
      if (mode === 'edit') out[f.name] = null;
      continue;
    }
    out[f.name] = f.type === 'number' ? Number(v) : v;
  }
  return out;
}

/**
 * Keeps only the fields of an edit payload whose value differs from the
 * record being edited (null and '' count as equal), so a PATCH sends just
 * what the user changed.
 */
export function changedOnly(payload: Values, original: Values | null | undefined): Values {
  if (!original) return payload;
  const norm = (v: any) => (v === undefined || v === null || v === '' ? null : typeof v === 'number' ? v : String(v));
  const out: Values = {};
  for (const [k, v] of Object.entries(payload)) {
    const before = original[k];
    const same =
      typeof v === 'boolean' ? v === !!before : typeof v === 'number' && before != null && before !== '' ? v === Number(before) : norm(v) === norm(before);
    if (!same) out[k] = v;
  }
  return out;
}

/** Config-driven form used by the master-data screens. */
export function EntityForm({
  fields,
  initial,
  mode = 'create',
  loading,
  onSubmit,
  onCancel,
  submitLabel,
  children,
  columns = 2,
}: {
  children?: React.ReactNode;
  columns?: 2 | 3;
  fields: FieldDef[];
  initial?: Values;
  mode?: 'create' | 'edit';
  loading?: boolean;
  onSubmit: (payload: Values) => void;
  onCancel: () => void;
  submitLabel?: string;
}) {
  const t = useTranslations('ops');
  const [values, setValues] = useState<Values>(() => toInitial(fields, initial));
  const set = (name: string, value: any) => setValues((prev) => ({ ...prev, [name]: value }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(buildPayload(fields, values, mode));
      }}
      className="space-y-4"
    >
      <div className={clsx('grid grid-cols-1 md:grid-cols-2 gap-4', columns === 3 && 'lg:grid-cols-3')}>
        {fields
          .filter((f) => !f.hidden)
          .map((f) => {
            if (f.type === 'checkbox') {
              return (
                <label key={f.name} className={clsx('flex items-center gap-2 text-sm pt-6', f.wide && 'md:col-span-2')}>
                  <input type="checkbox" checked={!!values[f.name]} onChange={(e) => set(f.name, e.target.checked)} />
                  {f.label}
                </label>
              );
            }
            let control: React.ReactNode;
            if (f.type === 'select') {
              control = (
                <select
                  value={values[f.name]}
                  onChange={(e) => set(f.name, e.target.value)}
                  className={inputCls}
                  required={f.required}
                >
                  <option value="">{f.emptyLabel ?? '-'}</option>
                  {(f.options ?? []).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              );
            } else if (f.type === 'textarea') {
              control = (
                <textarea
                  value={values[f.name]}
                  onChange={(e) => set(f.name, e.target.value)}
                  className={inputCls}
                  rows={3}
                  required={f.required}
                  placeholder={f.placeholder}
                />
              );
            } else {
              control = (
                <input
                  type={f.type ?? 'text'}
                  value={values[f.name]}
                  onChange={(e) => set(f.name, e.target.value)}
                  className={inputCls}
                  required={f.required}
                  placeholder={f.placeholder}
                  min={f.min}
                  max={f.max}
                  step={f.type === 'number' ? f.step ?? 'any' : undefined}
                  autoComplete={f.type === 'password' ? 'new-password' : undefined}
                />
              );
            }
            return (
              <Field key={f.name} label={f.label} hint={f.hint} required={f.required} className={f.wide ? 'md:col-span-2' : undefined}>
                {control}
              </Field>
            );
          })}
      </div>
      {children}
      <div className="flex justify-end gap-2 pt-2">
        <Btn variant="secondary" onClick={onCancel}>
          {t('common.cancel')}
        </Btn>
        <Btn type="submit" loading={loading}>
          {submitLabel ?? t('common.save')}
        </Btn>
      </div>
    </form>
  );
}
