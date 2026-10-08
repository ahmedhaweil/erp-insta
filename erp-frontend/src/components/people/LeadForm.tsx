'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Field, FormActions, Input, Select, TextArea } from './ui';
import { useCrmStages, useCustomers, useLabelMap, useLocalName, useUsers } from '@/hooks/use-people';
import { LEAD_SOURCES, type CrmLead } from '@/services/people-crm.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const TEXT = ['title', 'contactName', 'companyName', 'email', 'phone', 'address', 'city', 'country', 'description'] as const;

const blank = {
  title: '', type: 'lead', stageId: '', probability: '', expectedRevenue: '', expectedCloseDate: '', source: 'other',
  assignedUserId: '', customerId: '', contactName: '', companyName: '', email: '', phone: '', address: '', city: '',
  country: '', description: '',
};
export type LeadFormState = typeof blank;

export function toLeadBody(form: LeadFormState, editing: boolean): Record<string, any> {
  const body: Record<string, any> = { type: form.type, source: form.source };
  for (const key of TEXT) {
    const v = form[key].trim();
    if (v) body[key] = v;
    else if (editing && key !== 'title') body[key] = undefined;
  }
  for (const key of ['stageId', 'assignedUserId', 'customerId', 'expectedCloseDate'] as const) {
    if (form[key]) body[key] = form[key];
  }
  if (form.probability !== '') body.probability = Number(form.probability);
  if (form.expectedRevenue !== '') body.expectedRevenue = Number(form.expectedRevenue);
  return body;
}

export default function LeadForm({
  lead,
  defaultStageId,
  submitting,
  onSubmit,
  onCancel,
  compact,
}: {
  lead?: CrmLead | null;
  defaultStageId?: string;
  submitting?: boolean;
  onSubmit: (body: Record<string, any>) => void;
  onCancel?: () => void;
  compact?: boolean;
}) {
  const t = useTranslations('crm');
  const tc = useTranslations('common');
  const tp = useTranslations('people');
  const name = useLocalName();
  const { data: stages = [] } = useCrmStages();
  const { data: customers } = useCustomers();
  const { data: users = [] } = useUsers();
  const customerMap = useLabelMap(customers);
  const [form, setForm] = useState<LeadFormState>({ ...blank, stageId: defaultStageId ?? '' });

  useEffect(() => {
    if (!lead) return;
    const next: any = { ...blank };
    for (const key of Object.keys(blank)) {
      const v = (lead as any)[key];
      if (v !== null && v !== undefined) next[key] = String(v);
    }
    next.probability = String(Number(lead.probability));
    next.expectedRevenue = String(Number(lead.expectedRevenue));
    next.expectedCloseDate = lead.expectedCloseDate ? String(lead.expectedCloseDate).slice(0, 10) : '';
    setForm(next);
  }, [lead]);

  const set = (key: keyof LeadFormState, value: string) => setForm((f) => ({ ...f, [key]: value }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(toLeadBody(form, !!lead));
  };
  const text = (key: keyof LeadFormState, label: string, props: Record<string, any> = {}) => (
    <Field label={label} required={props.required}>
      <Input value={form[key]} onChange={(e) => set(key, e.target.value)} {...props} />
    </Field>
  );
  const grid = compact ? 'grid grid-cols-1 md:grid-cols-2 gap-4' : 'grid grid-cols-1 md:grid-cols-3 gap-4';

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className={grid}>
        {text('title', t('leadTitle'), { required: true })}
        <Field label={t('type')}>
          <Select value={form.type} onChange={(e) => set('type', e.target.value)} options={['lead', 'opportunity'].map((v) => ({ value: v, label: t(`type_${v}`) }))} />
        </Field>
        <Field label={t('stage')}>
          <Select value={form.stageId} onChange={(e) => set('stageId', e.target.value)} placeholder={t('firstStage')} options={stages.map((s) => ({ value: s.id, label: name(s) }))} />
        </Field>
        {text('expectedRevenue', t('expectedRevenue'), { type: 'number', step: 'any', min: 0 })}
        {text('probability', t('probability'), { type: 'number', step: 'any', min: 0, max: 100, placeholder: t('stageDefault') })}
        {text('expectedCloseDate', t('expectedCloseDate'), { type: 'date' })}
        <Field label={t('source')}>
          <Select value={form.source} onChange={(e) => set('source', e.target.value)} options={LEAD_SOURCES.map((v) => ({ value: v, label: t(`source_${v}`) }))} />
        </Field>
        <Field label={t('salesperson')}>
          <Select value={form.assignedUserId} onChange={(e) => set('assignedUserId', e.target.value)} placeholder={t('currentUser')} options={users.map((u) => ({ value: u.id, label: u.name ?? u.email ?? u.id }))} />
        </Field>
        <Field label={t('customer')}>
          <Select value={form.customerId} onChange={(e) => set('customerId', e.target.value)} placeholder={tp('none')} options={[...customerMap].map(([value, label]) => ({ value, label }))} />
        </Field>
        {text('contactName', t('contactName'))}
        {text('companyName', t('companyName'))}
        {text('email', tc('email'), { type: 'email' })}
        {text('phone', tc('phone'))}
        {!compact && text('address', tc('address'))}
        {!compact && text('city', t('city'))}
        {!compact && text('country', t('country'))}
      </div>
      <Field label={tc('description')}>
        <TextArea rows={compact ? 2 : 3} value={form.description} onChange={(e) => set('description', e.target.value)} />
      </Field>
      <FormActions onCancel={onCancel} submitting={submitting} />
    </form>
  );
}
