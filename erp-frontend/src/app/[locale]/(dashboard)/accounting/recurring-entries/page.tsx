'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import StatusBadge from '@/components/ui/StatusBadge';
import LinesEditor, { drCrPayload, drCrTotals, drCrValid, emptyDrCr, type DrCrLine } from '@/components/finance/LinesEditor';
import { useAccountLabel } from '@/components/finance/AccountPicker';
import { Btn, Field, KeyValue, Money, Spinner, inputCls, todayIso } from '@/components/finance/ui';
import { byId, useFinAction, useJournals } from '@/hooks/use-finance';
import { depthService, type RecurringEntry, type RecurringFrequency, type RecurringRunResult } from '@/services/finance-depth.service';

const FREQS: RecurringFrequency[] = ['monthly', 'quarterly', 'yearly', 'days'];
const emptyForm = {
  name: '',
  description: '',
  journalId: '',
  frequency: 'monthly' as RecurringFrequency,
  intervalDays: '',
  startDate: todayIso(),
  endDate: '',
  autoPost: true,
};

/** Recurring journal entries (قيود دورية): templates generated on schedule. */
export default function RecurringEntriesPage() {
  const t = useTranslations('depth');
  const ta = useTranslations('acct');
  const tc = useTranslations('common');
  const accountLabel = useAccountLabel();
  const { data: journals = [] } = useJournals();
  const journalsById = byId(journals);
  const { data: templates = [], isLoading } = useQuery({ queryKey: ['recurring-entries'], queryFn: depthService.recurring });

  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [lines, setLines] = useState<DrCrLine[]>([emptyDrCr(), emptyDrCr()]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [asOf, setAsOf] = useState(todayIso());
  const [lastRun, setLastRun] = useState<RecurringRunResult | null>(null);

  const detail = useQuery({
    queryKey: ['recurring-entries', detailId],
    queryFn: () => depthService.recurringById(detailId!),
    enabled: !!detailId,
  });

  const totals = drCrTotals(lines);
  const canSave =
    form.name &&
    form.startDate &&
    lines.length >= 2 &&
    drCrValid(lines) &&
    totals.diff === 0 &&
    totals.debit > 0 &&
    (form.frequency !== 'days' || Number(form.intervalDays) >= 1);

  const create = useFinAction(
    () =>
      depthService.createRecurring({
        name: form.name,
        description: form.description || undefined,
        journalId: form.journalId || undefined,
        frequency: form.frequency,
        intervalDays: form.frequency === 'days' ? Number(form.intervalDays) : undefined,
        startDate: form.startDate,
        endDate: form.endDate || undefined,
        autoPost: form.autoPost,
        lines: drCrPayload(lines),
      }),
    { invalidate: ['recurring-entries'], onSuccess: () => setShowNew(false) },
  );
  const setStatus = useFinAction(
    ({ id, status }: { id: string; status: 'active' | 'paused' }) => depthService.updateRecurring(id, { status }),
    { invalidate: ['recurring-entries'] },
  );
  const runDue = useFinAction(() => depthService.runRecurringDue(asOf), {
    invalidate: ['recurring-entries', 'fin-journal-entries'],
    success: t('runDone'),
    onSuccess: (r) => setLastRun(r),
  });
  const runOne = useFinAction((id: string) => depthService.runRecurringOne(id, asOf), {
    invalidate: ['recurring-entries', 'fin-journal-entries'],
    success: t('runDone'),
    onSuccess: (r) => setLastRun(r),
  });

  const freqLabel = (r: RecurringEntry) => (r.frequency === 'days' ? t('everyNDays', { n: r.intervalDays ?? 0 }) : t(`freq_${r.frequency}`));
  const amountOf = (r: RecurringEntry) => (r.lines ?? []).reduce((s, l) => s + Number(l.debit || 0), 0);

  const columns = [
    { key: 'name', header: tc('name') },
    { key: 'frequency', header: t('frequency'), render: freqLabel },
    { key: 'amount', header: tc('amount'), render: (r: RecurringEntry) => <Money value={amountOf(r)} /> },
    { key: 'nextRunDate', header: t('nextRun') },
    { key: 'lastRunDate', header: t('lastRun') },
    { key: 'runCount', header: t('runCount') },
    { key: 'autoPost', header: t('autoPost'), render: (r: RecurringEntry) => (r.autoPost ? tc('yes') : tc('no')) },
    {
      key: 'status',
      header: tc('status'),
      render: (r: RecurringEntry) => (
        <StatusBadge status={r.status === 'paused' ? 'pending' : r.status === 'done' ? 'closed' : 'active'} label={t(`rstatus_${r.status}`)} />
      ),
    },
  ];

  const openNew = () => {
    setForm({ ...emptyForm, startDate: todayIso(), journalId: journals.find((j) => j.type === 'general')?.id ?? '' });
    setLines([emptyDrCr(), emptyDrCr()]);
    setShowNew(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('recurringTitle')}</h1>
          <p className="text-sm text-gray-500">{t('recurringIntro')}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t('asOf')}>
            <input type="date" className={inputCls} value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          </Field>
          <Btn variant="secondary" disabled={runDue.isPending} onClick={() => runDue.mutate(undefined)}>
            {t('runDue')}
          </Btn>
          <Btn onClick={openNew}>{t('newRecurring')}</Btn>
        </div>
      </div>

      {lastRun && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 text-sm space-y-1">
          <p className="font-semibold">{t('runResult', { date: lastRun.asOf })}</p>
          {lastRun.results.length === 0 && <p className="text-gray-500">{t('nothingDue')}</p>}
          {lastRun.results.map((r) => (
            <p key={r.templateId} className={r.error ? 'text-red-600' : ''}>
              {r.name}: {r.generated.map((g) => `${g.refNumber} (${g.date})`).join('، ') || '-'} {r.error ? `— ${r.error}` : ''}
            </p>
          ))}
        </div>
      )}

      <DataTable
        columns={columns}
        data={templates}
        loading={isLoading}
        searchable
        onRowClick={(r) => setDetailId(r.id)}
        actions={(r) => (
          <div className="flex gap-1">
            {r.status === 'active' && (
              <Btn size="sm" variant="ghost" onClick={() => runOne.mutate(r.id)} disabled={runOne.isPending}>
                {t('runNow')}
              </Btn>
            )}
            {r.status === 'active' && (
              <Btn size="sm" variant="ghost" onClick={() => setStatus.mutate({ id: r.id, status: 'paused' })}>
                {t('pause')}
              </Btn>
            )}
            {r.status === 'paused' && (
              <Btn size="sm" variant="ghost" onClick={() => setStatus.mutate({ id: r.id, status: 'active' })}>
                {t('resume')}
              </Btn>
            )}
          </div>
        )}
      />

      <Modal isOpen={!!detailId} onClose={() => setDetailId(null)} title={detail.data?.name ?? ''} size="xl">
        {detail.isLoading || !detail.data ? (
          <Spinner />
        ) : (
          <div className="space-y-4">
            <KeyValue
              items={[
                { label: t('frequency'), value: freqLabel(detail.data) },
                { label: ta('journal'), value: detail.data.journalId ? journalsById[detail.data.journalId]?.name : '-' },
                { label: t('startDate'), value: detail.data.startDate },
                { label: t('endDate'), value: detail.data.endDate ?? '-' },
              ]}
            />
            <table className="w-full text-sm border border-gray-200 rounded-lg">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-start px-3 py-2">{ta('account')}</th>
                  <th className="text-start px-3 py-2">{tc('description')}</th>
                  <th className="text-end px-3 py-2">{ta('debit')}</th>
                  <th className="text-end px-3 py-2">{ta('credit')}</th>
                </tr>
              </thead>
              <tbody>
                {(detail.data.lines ?? []).map((l, i) => (
                  <tr key={l.id ?? i} className="border-t border-gray-100">
                    <td className="px-3 py-1.5">{accountLabel(l.accountId)}</td>
                    <td className="px-3 py-1.5">{l.description}</td>
                    <td className="px-3 py-1.5 text-end">{Number(l.debit) ? <Money value={l.debit} /> : ''}</td>
                    <td className="px-3 py-1.5 text-end">{Number(l.credit) ? <Money value={l.credit} /> : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="grid md:grid-cols-2 gap-4 text-sm">
              <div>
                <h3 className="font-semibold mb-2">{t('upcoming')}</h3>
                <ul className="space-y-1" dir="ltr">
                  {(detail.data.upcoming ?? []).map((u) => (
                    <li key={u} className="text-start">{u}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="font-semibold mb-2">{t('generated')}</h3>
                {(detail.data.runs ?? []).length === 0 ? (
                  <p className="text-gray-500">-</p>
                ) : (
                  <ul className="space-y-1">
                    {(detail.data.runs ?? []).map((r) => (
                      <li key={r.id}>{r.runDate}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={showNew} onClose={() => setShowNew(false)} title={t('newRecurring')} size="xl">
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Field label={tc('name') + ' *'} className="md:col-span-2">
              <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label={ta('journal')}>
              <select className={inputCls} value={form.journalId} onChange={(e) => setForm({ ...form, journalId: e.target.value })}>
                <option value="">-</option>
                {journals.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('frequency')}>
              <select
                className={inputCls}
                value={form.frequency}
                onChange={(e) => setForm({ ...form, frequency: e.target.value as RecurringFrequency })}
              >
                {FREQS.map((f) => (
                  <option key={f} value={f}>
                    {t(`freq_${f}`)}
                  </option>
                ))}
              </select>
            </Field>
            {form.frequency === 'days' && (
              <Field label={t('intervalDays') + ' *'}>
                <input type="number" min={1} className={inputCls} value={form.intervalDays} onChange={(e) => setForm({ ...form, intervalDays: e.target.value })} />
              </Field>
            )}
            <Field label={t('startDate') + ' *'}>
              <input type="date" className={inputCls} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
            </Field>
            <Field label={t('endDate')}>
              <input type="date" className={inputCls} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
            </Field>
            <Field label={tc('description')} className="md:col-span-2">
              <input className={inputCls} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 text-sm pt-6">
              <input type="checkbox" checked={form.autoPost} onChange={(e) => setForm({ ...form, autoPost: e.target.checked })} />
              {t('autoPostHint')}
            </label>
          </div>
          <LinesEditor lines={lines} onChange={setLines} minLines={2} />
          <div className="flex justify-end gap-3">
            <Btn variant="secondary" onClick={() => setShowNew(false)}>
              {tc('cancel')}
            </Btn>
            <Btn disabled={!canSave || create.isPending} onClick={() => create.mutate(undefined)}>
              {tc('save')}
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}
