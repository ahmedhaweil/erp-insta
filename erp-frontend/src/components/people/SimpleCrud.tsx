'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { usePeopleMutation, usePeopleQuery } from '@/hooks/use-people';
import { Checkbox, Field, FormActions, Input, LinkButton, Select, type Option } from './ui';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface CrudField {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'time' | 'checkbox' | 'select' | 'weekdays';
  required?: boolean;
  options?: Option[];
  defaultValue?: any;
  step?: string;
  /** Only editable when creating. */
  createOnly?: boolean;
}

export interface CrudColumn<T> {
  key: string;
  header: string;
  render?: (item: T) => ReactNode;
}

interface Props<T extends { id: string }> {
  title: string;
  newLabel: string;
  queryKey: string;
  load: () => Promise<T[]>;
  create: (body: Record<string, any>) => Promise<unknown>;
  update?: (id: string, body: Record<string, any>) => Promise<unknown>;
  remove?: (id: string) => Promise<unknown>;
  fields: CrudField[];
  columns: CrudColumn<T>[];
  toolbar?: ReactNode;
}

export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

function toBody(fields: CrudField[], values: Record<string, any>, editing: boolean) {
  const body: Record<string, any> = {};
  for (const f of fields) {
    if (editing && f.createOnly) continue;
    const v = values[f.name];
    if (f.type === 'number') {
      if (v === '' || v === undefined || v === null) continue;
      body[f.name] = Number(v);
    } else if (f.type === 'checkbox' || f.type === 'weekdays') {
      body[f.name] = v;
    } else if (v === '' || v === undefined) {
      if (editing && f.type === 'select') body[f.name] = null;
    } else {
      body[f.name] = v;
    }
  }
  return body;
}

export default function SimpleCrud<T extends { id: string }>({ title, newLabel, queryKey, load, create, update, remove, fields, columns, toolbar }: Props<T>) {
  const tc = useTranslations('common');
  const tp = useTranslations('people');
  const { data = [], isLoading } = usePeopleQuery([queryKey], load);
  const [editing, setEditing] = useState<T | null>(null);
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, any>>({});
  const [deleting, setDeleting] = useState<T | null>(null);

  const save = usePeopleMutation(
    (body: Record<string, any>) => (editing && update ? update(editing.id, body) : create(body)),
    { invalidate: [queryKey], onSuccess: () => setOpen(false) },
  );
  const del = usePeopleMutation((id: string) => remove!(id), {
    invalidate: [queryKey],
    success: tc('deleteSuccess'),
    onSuccess: () => setDeleting(null),
  });

  const openForm = (item: T | null) => {
    const initial: Record<string, any> = {};
    for (const f of fields) {
      const current = item ? (item as any)[f.name] : undefined;
      initial[f.name] =
        current !== undefined && current !== null
          ? f.type === 'date' ? String(current).slice(0, 10) : current
          : f.defaultValue ?? (f.type === 'checkbox' ? false : f.type === 'weekdays' ? [] : '');
    }
    setValues(initial);
    setEditing(item);
    setOpen(true);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(toBody(fields, values, !!editing));
  };

  const set = (name: string, value: any) => setValues((prev) => ({ ...prev, [name]: value }));

  const renderInput = (f: CrudField) => {
    const disabled = !!editing && f.createOnly;
    const value = values[f.name];
    switch (f.type) {
      case 'checkbox':
        return <Checkbox key={f.name} label={f.label} checked={!!value} disabled={disabled} onChange={(v) => set(f.name, v)} />;
      case 'select':
        return (
          <Field key={f.name} label={f.label} required={f.required}>
            <Select value={value ?? ''} disabled={disabled} required={f.required} placeholder={tp('select')} options={f.options ?? []} onChange={(e) => set(f.name, e.target.value)} />
          </Field>
        );
      case 'weekdays':
        return (
          <Field key={f.name} label={f.label}>
            <div className="flex flex-wrap gap-3">
              {WEEKDAYS.map((d) => (
                <Checkbox
                  key={d}
                  label={tp(`weekday${d}`)}
                  checked={(value ?? []).includes(d)}
                  onChange={(checked) =>
                    set(f.name, checked ? [...(value ?? []), d].sort() : (value ?? []).filter((x: number) => x !== d))
                  }
                />
              ))}
            </div>
          </Field>
        );
      default:
        return (
          <Field key={f.name} label={f.label} required={f.required}>
            <Input
              type={f.type ?? 'text'}
              step={f.step ?? (f.type === 'number' ? 'any' : undefined)}
              value={value ?? ''}
              disabled={disabled}
              required={f.required}
              onChange={(e) => set(f.name, e.target.value)}
            />
          </Field>
        );
    }
  };

  return (
    <div>
      <PageHeader title={title} action={{ label: newLabel, onClick: () => openForm(null) }} />
      {toolbar}
      <DataTable
        columns={columns}
        data={data}
        loading={isLoading}
        searchable
        actions={
          update || remove
            ? (item: T) => (
                <div className="flex gap-3">
                  {update && (
                    <LinkButton className="text-primary-600" onClick={() => openForm(item)}>
                      {tc('edit')}
                    </LinkButton>
                  )}
                  {remove && (
                    <LinkButton className="text-red-600" onClick={() => setDeleting(item)}>
                      {tc('delete')}
                    </LinkButton>
                  )}
                </div>
              )
            : undefined
        }
      />
      <Modal isOpen={open} onClose={() => setOpen(false)} title={editing ? tc('edit') : newLabel}>
        <form onSubmit={submit} className="space-y-4">
          {fields.map(renderInput)}
          <FormActions onCancel={() => setOpen(false)} submitting={save.isPending} />
        </form>
      </Modal>
      <ConfirmDialog
        isOpen={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && del.mutate(deleting.id)}
        title={tc('delete')}
        message={tc('confirmDelete')}
        destructive
        loading={del.isPending}
      />
    </div>
  );
}
