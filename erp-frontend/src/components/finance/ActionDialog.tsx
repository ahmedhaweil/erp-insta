'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Modal from '@/components/ui/Modal';
import AccountPicker from './AccountPicker';
import { Btn, Field, inputCls } from './ui';

export type ActionField =
  | { name: string; label: string; type: 'date' | 'text' | 'number' | 'textarea'; required?: boolean; defaultValue?: string | number }
  | { name: string; label: string; type: 'checkbox'; defaultValue?: boolean }
  | { name: string; label: string; type: 'select'; options: { value: string; label: string }[]; required?: boolean; defaultValue?: string }
  | { name: string; label: string; type: 'account'; required?: boolean; defaultValue?: string };

/**
 * Small form dialog used by workflow actions that need a few inputs (a date,
 * a note, a bank...). Calls onSubmit with the typed values; number fields are
 * converted, empty values dropped.
 */
export default function ActionDialog({
  open,
  title,
  message,
  fields,
  submitLabel,
  destructive,
  loading,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  message?: string;
  fields: ActionField[];
  submitLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onClose: () => void;
  onSubmit: (values: Record<string, any>) => void;
}) {
  const tc = useTranslations('common');
  const [values, setValues] = useState<Record<string, any>>({});

  useEffect(() => {
    if (open) {
      const init: Record<string, any> = {};
      for (const f of fields) init[f.name] = f.defaultValue ?? (f.type === 'checkbox' ? false : '');
      setValues(init);
    }
    // fields are rebuilt on every render by callers; reset only when opening
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = (name: string, v: any) => setValues((s) => ({ ...s, [name]: v }));

  const missing = fields.some((f) => 'required' in f && f.required && (values[f.name] === '' || values[f.name] == null));

  const submit = () => {
    const out: Record<string, any> = {};
    for (const f of fields) {
      const v = values[f.name];
      if (f.type === 'checkbox') out[f.name] = !!v;
      else if (v === '' || v == null) continue;
      else if (f.type === 'number') out[f.name] = Number(v);
      else out[f.name] = v;
    }
    onSubmit(out);
  };

  return (
    <Modal isOpen={open} onClose={onClose} title={title} size="md">
      <div className="space-y-4">
        {message && <p className="text-sm text-gray-600">{message}</p>}
        {fields.map((f) => {
          if (f.type === 'checkbox') {
            return (
              <label key={f.name} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!values[f.name]} onChange={(e) => set(f.name, e.target.checked)} />
                {f.label}
              </label>
            );
          }
          return (
            <Field key={f.name} label={f.label + ('required' in f && f.required ? ' *' : '')}>
              {f.type === 'select' ? (
                <select className={inputCls} value={values[f.name] ?? ''} onChange={(e) => set(f.name, e.target.value)}>
                  <option value="">-</option>
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : f.type === 'account' ? (
                <AccountPicker value={values[f.name]} onChange={(id) => set(f.name, id)} />
              ) : f.type === 'textarea' ? (
                <textarea className={inputCls} rows={2} value={values[f.name] ?? ''} onChange={(e) => set(f.name, e.target.value)} />
              ) : (
                <input
                  type={f.type}
                  step={f.type === 'number' ? 'any' : undefined}
                  className={inputCls}
                  value={values[f.name] ?? ''}
                  onChange={(e) => set(f.name, e.target.value)}
                />
              )}
            </Field>
          );
        })}
        <div className="flex justify-end gap-3 pt-2">
          <Btn variant="secondary" onClick={onClose} disabled={loading}>
            {tc('cancel')}
          </Btn>
          <Btn variant={destructive ? 'danger' : 'primary'} onClick={submit} disabled={loading || missing}>
            {loading ? tc('loading') : submitLabel || tc('confirm')}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
