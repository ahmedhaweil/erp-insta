'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import StatusBadge from '@/components/ui/StatusBadge';
import Modal from '@/components/ui/Modal';
import { Field, FormActions, Input, LinkButton, Select, SimpleTable, TextArea, td, todayIso } from './ui';
import { usePeopleMutation, useUsers } from '@/hooks/use-people';
import { ACTIVITY_TYPES, crmService, type CrmActivity } from '@/services/people-crm.service';

const STATE_COLORS: Record<string, string> = { overdue: 'overdue', today: 'pending', planned: 'confirmed', done: 'completed', cancelled: 'cancelled' };

export function ActivityTable({ activities, labelFor }: { activities: CrmActivity[]; labelFor?: (a: CrmActivity) => string }) {
  const t = useTranslations('crm');
  const tc = useTranslations('common');
  const [completing, setCompleting] = useState<CrmActivity | null>(null);
  const [result, setResult] = useState('');
  const invalidate = ['crm-activities'];
  const done = usePeopleMutation((input: { id: string; result: string }) => crmService.doneActivity(input.id, input.result || undefined), {
    invalidate,
    success: t('activityDone'),
    onSuccess: () => setCompleting(null),
  });
  const cancel = usePeopleMutation((id: string) => crmService.cancelActivity(id), { invalidate, success: t('activityCancelled') });

  return (
    <>
      <SimpleTable headers={[t('dueDate'), t('activityType'), t('subject'), ...(labelFor ? [t('relatedTo')] : []), tc('status'), t('result'), tc('actions')]}>
        {activities.map((a) => (
          <tr key={a.id}>
            <td className={td}>{String(a.dueDate).slice(0, 10)}</td>
            <td className={td}>{t(`activity_${a.type}`)}</td>
            <td className="px-3 py-2">
              <div className="font-medium">{a.subject}</div>
              {a.notes && <div className="text-xs text-gray-500">{a.notes}</div>}
            </td>
            {labelFor && <td className={td}>{labelFor(a)}</td>}
            <td className={td}>
              <StatusBadge status={STATE_COLORS[a.state]} label={t(`state_${a.state}`)} />
            </td>
            <td className="px-3 py-2 text-xs text-gray-600">{a.result || '-'}</td>
            <td className={td}>
              {a.status === 'planned' && (
                <div className="flex gap-3">
                  <LinkButton className="text-green-600" onClick={() => { setResult(''); setCompleting(a); }}>
                    {t('markDone')}
                  </LinkButton>
                  <LinkButton className="text-red-600" disabled={cancel.isPending} onClick={() => cancel.mutate(a.id)}>
                    {tc('cancel')}
                  </LinkButton>
                </div>
              )}
            </td>
          </tr>
        ))}
        {!activities.length && (
          <tr>
            <td colSpan={7} className="p-8 text-center text-gray-500">{tc('noData')}</td>
          </tr>
        )}
      </SimpleTable>
      <Modal isOpen={!!completing} onClose={() => setCompleting(null)} title={`${t('markDone')}: ${completing?.subject ?? ''}`} size="sm">
        <form onSubmit={(e) => { e.preventDefault(); if (completing) done.mutate({ id: completing.id, result }); }} className="space-y-4">
          <Field label={t('result')}>
            <TextArea rows={3} value={result} onChange={(e) => setResult(e.target.value)} />
          </Field>
          <FormActions onCancel={() => setCompleting(null)} submitting={done.isPending} submitLabel={t('markDone')} />
        </form>
      </Modal>
    </>
  );
}

/** Modal to schedule an activity on a lead or a customer. */
export function ActivityFormModal({
  isOpen,
  onClose,
  leadId,
  customerId,
  leadOptions,
}: {
  isOpen: boolean;
  onClose: () => void;
  leadId?: string;
  customerId?: string;
  leadOptions?: { value: string; label: string }[];
}) {
  const t = useTranslations('crm');
  const tc = useTranslations('common');
  const tp = useTranslations('people');
  const { data: users = [] } = useUsers();
  const blank = { type: 'call', subject: '', notes: '', dueDate: todayIso(), assignedUserId: '', leadId: leadId ?? '' };
  const [form, setForm] = useState(blank);
  const create = usePeopleMutation((body: typeof blank) => crmService.createActivity({ ...body, customerId }), {
    invalidate: ['crm-activities'],
    success: t('activityScheduled'),
    onSuccess: () => {
      setForm(blank);
      onClose();
    },
  });
  const set = (key: keyof typeof blank, value: string) => setForm((f) => ({ ...f, [key]: value }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate({ ...form, leadId: leadId ?? form.leadId });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('scheduleActivity')}>
      <form onSubmit={submit} className="space-y-4">
        {!leadId && leadOptions && (
          <Field label={t('lead')} required={!customerId}>
            <Select required={!customerId} value={form.leadId} onChange={(e) => set('leadId', e.target.value)} placeholder={tp('select')} options={leadOptions} />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-4">
          <Field label={t('activityType')} required>
            <Select value={form.type} onChange={(e) => set('type', e.target.value)} options={ACTIVITY_TYPES.map((v) => ({ value: v, label: t(`activity_${v}`) }))} />
          </Field>
          <Field label={t('dueDate')} required>
            <Input type="date" required value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
          </Field>
        </div>
        <Field label={t('subject')} required>
          <Input required value={form.subject} onChange={(e) => set('subject', e.target.value)} />
        </Field>
        <Field label={t('assignedTo')}>
          <Select value={form.assignedUserId} onChange={(e) => set('assignedUserId', e.target.value)} placeholder={t('defaultAssignee')} options={users.map((u) => ({ value: u.id, label: u.name ?? u.id }))} />
        </Field>
        <Field label={tc('notes')}>
          <TextArea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <FormActions onCancel={onClose} submitting={create.isPending} />
      </form>
    </Modal>
  );
}
