'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import StatusBadge from '@/components/ui/StatusBadge';
import AccountPicker, { useAccountLabel } from '@/components/finance/AccountPicker';
import { Btn, Field, KeyValue, Money, Spinner, Tabs, inputCls, todayIso, useLocalName } from '@/components/finance/ui';
import { useBranches, useCostCenters, useFinAction } from '@/hooks/use-finance';
import { depthService, type Deferral, type DeferralType } from '@/services/finance-depth.service';

const emptyForm = {
  type: 'expense' as DeferralType,
  name: '',
  reference: '',
  amount: '',
  deferralAccountId: '',
  plAccountId: '',
  counterpartAccountId: '',
  startDate: todayIso(),
  months: '12',
  costCenterId: '',
  branchId: '',
};

/** Deferred revenue / prepaid expenses recognised monthly (إيرادات ومصروفات مقدمة). */
export default function DeferralsPage() {
  const t = useTranslations('depth');
  const tc = useTranslations('common');
  const name = useLocalName();
  const accountLabel = useAccountLabel();
  const { data: costCenters = [] } = useCostCenters();
  const { data: branches = [] } = useBranches();
  const [tab, setTab] = useState<'all' | DeferralType>('all');
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['deferrals', tab],
    queryFn: () => depthService.deferrals(tab === 'all' ? undefined : tab),
  });
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<Deferral | null>(null);
  const [cancelForm, setCancelForm] = useState({ recognizeRemaining: false, date: todayIso() });
  const [asOf, setAsOf] = useState(todayIso());
  const detail = useQuery({ queryKey: ['deferrals', 'one', detailId], queryFn: () => depthService.deferral(detailId!), enabled: !!detailId });

  const create = useFinAction(
    () =>
      depthService.createDeferral({
        type: form.type,
        name: form.name,
        reference: form.reference || undefined,
        amount: Number(form.amount),
        deferralAccountId: form.deferralAccountId,
        plAccountId: form.plAccountId,
        counterpartAccountId: form.counterpartAccountId || undefined,
        startDate: form.startDate,
        months: Number(form.months),
        costCenterId: form.costCenterId || undefined,
        branchId: form.branchId || undefined,
      }),
    { invalidate: ['deferrals'], onSuccess: () => setShowNew(false) },
  );
  const runDue = useFinAction(() => depthService.runDeferralsDue(asOf), {
    invalidate: ['deferrals', 'fin-journal-entries'],
    success: t('runDone'),
  });
  const cancel = useFinAction(
    () =>
      depthService.cancelDeferral(cancelling!.id, {
        recognizeRemaining: cancelForm.recognizeRemaining || undefined,
        date: cancelForm.recognizeRemaining ? cancelForm.date : undefined,
      }),
    { invalidate: ['deferrals', 'fin-journal-entries'], onSuccess: () => setCancelling(null) },
  );

  const canSave =
    form.name && Number(form.amount) > 0 && form.deferralAccountId && form.plAccountId && form.startDate && Number(form.months) >= 1;

  const statusBadge = (s: string) => (
    <StatusBadge status={s === 'active' ? 'active' : s === 'completed' ? 'completed' : s === 'posted' ? 'posted' : s === 'planned' ? 'draft' : 'cancelled'} label={t(`dstatus_${s}`)} />
  );

  const columns = [
    { key: 'scheduleNumber', header: tc('code') },
    { key: 'type', header: t('deferralType'), render: (r: Deferral) => t(`dtype_${r.type}`) },
    { key: 'name', header: tc('name') },
    { key: 'startDate', header: t('startDate') },
    { key: 'months', header: t('months') },
    { key: 'amount', header: tc('amount'), render: (r: Deferral) => <Money value={r.amount} /> },
    { key: 'recognizedAmount', header: t('recognized'), render: (r: Deferral) => <Money value={r.recognizedAmount} /> },
    { key: 'remaining', header: t('remaining'), render: (r: Deferral) => <Money value={Number(r.amount) - Number(r.recognizedAmount)} /> },
    { key: 'status', header: tc('status'), render: (r: Deferral) => statusBadge(r.status) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('deferralsTitle')}</h1>
          <p className="text-sm text-gray-500">{t('deferralsIntro')}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t('asOf')}>
            <input type="date" className={inputCls} value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          </Field>
          <Btn variant="secondary" disabled={runDue.isPending} onClick={() => runDue.mutate(undefined)}>
            {t('postDue')}
          </Btn>
          <Btn
            onClick={() => {
              setForm({ ...emptyForm, startDate: todayIso() });
              setShowNew(true);
            }}
          >
            {t('newDeferral')}
          </Btn>
        </div>
      </div>
      <Tabs
        tabs={[
          { key: 'all', label: tc('all') },
          { key: 'expense', label: t('dtype_expense') },
          { key: 'revenue', label: t('dtype_revenue') },
        ]}
        value={tab}
        onChange={setTab}
      />
      <DataTable
        columns={columns}
        data={rows}
        loading={isLoading}
        searchable
        onRowClick={(r) => setDetailId(r.id)}
        actions={(r) =>
          r.status === 'active' ? (
            <Btn
              size="sm"
              variant="ghost"
              onClick={() => {
                setCancelForm({ recognizeRemaining: false, date: todayIso() });
                setCancelling(r);
              }}
            >
              {tc('cancel')}
            </Btn>
          ) : null
        }
      />

      <Modal isOpen={!!detailId} onClose={() => setDetailId(null)} title={detail.data ? `${detail.data.scheduleNumber} - ${detail.data.name}` : ''} size="lg">
        {!detail.data ? (
          <Spinner />
        ) : (
          <div className="space-y-4">
            <KeyValue
              items={[
                { label: t('deferralAccount'), value: accountLabel(detail.data.deferralAccountId) },
                { label: t('plAccount'), value: accountLabel(detail.data.plAccountId) },
                { label: tc('amount'), value: <Money value={detail.data.amount} /> },
                { label: t('recognized'), value: <Money value={detail.data.recognizedAmount} /> },
              ]}
            />
            <table className="w-full text-sm border border-gray-200 rounded-lg">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-start px-3 py-2">#</th>
                  <th className="text-start px-3 py-2">{tc('date')}</th>
                  <th className="text-end px-3 py-2">{tc('amount')}</th>
                  <th className="text-start px-3 py-2">{tc('status')}</th>
                </tr>
              </thead>
              <tbody>
                {(detail.data.lines ?? []).map((l) => (
                  <tr key={l.id} className="border-t border-gray-100">
                    <td className="px-3 py-1.5">{l.sequence}</td>
                    <td className="px-3 py-1.5">{l.date}</td>
                    <td className="px-3 py-1.5 text-end">
                      <Money value={l.amount} />
                    </td>
                    <td className="px-3 py-1.5">{statusBadge(l.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>

      <Modal isOpen={showNew} onClose={() => setShowNew(false)} title={t('newDeferral')} size="xl">
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label={t('deferralType') + ' *'}>
              <select className={inputCls} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as DeferralType })}>
                <option value="expense">{t('dtype_expense')}</option>
                <option value="revenue">{t('dtype_revenue')}</option>
              </select>
            </Field>
            <Field label={tc('name') + ' *'}>
              <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label={t('reference')}>
              <input className={inputCls} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
            </Field>
            <Field label={tc('amount') + ' *'}>
              <input type="number" step="any" min="0" className={inputCls} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </Field>
            <Field label={t('startDate') + ' *'}>
              <input type="date" className={inputCls} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
            </Field>
            <Field label={t('months') + ' *'}>
              <input type="number" min={1} max={600} className={inputCls} value={form.months} onChange={(e) => setForm({ ...form, months: e.target.value })} />
            </Field>
            <Field label={t('deferralAccount') + ' *'} hint={form.type === 'revenue' ? t('deferralAccountRevenueHint') : t('deferralAccountExpenseHint')}>
              <AccountPicker value={form.deferralAccountId} onChange={(id) => setForm({ ...form, deferralAccountId: id })} />
            </Field>
            <Field label={t('plAccount') + ' *'} hint={form.type === 'revenue' ? t('plAccountRevenueHint') : t('plAccountExpenseHint')}>
              <AccountPicker value={form.plAccountId} onChange={(id) => setForm({ ...form, plAccountId: id })} />
            </Field>
            <Field label={t('counterpartAccount')} hint={t('counterpartHint')}>
              <AccountPicker value={form.counterpartAccountId} onChange={(id) => setForm({ ...form, counterpartAccountId: id })} />
            </Field>
            <Field label={t('costCenter')}>
              <select className={inputCls} value={form.costCenterId} onChange={(e) => setForm({ ...form, costCenterId: e.target.value })}>
                <option value="">-</option>
                {costCenters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} - {name(c)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('branch')}>
              <select className={inputCls} value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>
                <option value="">-</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {Number(form.amount) > 0 && Number(form.months) >= 1 && (
            <p className="text-sm text-gray-600">{t('monthlyAmount', { amount: (Number(form.amount) / Number(form.months)).toFixed(2) })}</p>
          )}
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

      <Modal isOpen={!!cancelling} onClose={() => setCancelling(null)} title={`${tc('cancel')} ${cancelling?.scheduleNumber ?? ''}`} size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">{t('cancelDeferralHint')}</p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={cancelForm.recognizeRemaining}
              onChange={(e) => setCancelForm({ ...cancelForm, recognizeRemaining: e.target.checked })}
            />
            {t('recognizeRemaining')}
          </label>
          {cancelForm.recognizeRemaining && (
            <Field label={tc('date')}>
              <input type="date" className={inputCls} value={cancelForm.date} onChange={(e) => setCancelForm({ ...cancelForm, date: e.target.value })} />
            </Field>
          )}
          <div className="flex justify-end gap-3">
            <Btn variant="secondary" onClick={() => setCancelling(null)}>
              {tc('back')}
            </Btn>
            <Btn variant="danger" disabled={cancel.isPending} onClick={() => cancel.mutate(undefined)}>
              {tc('confirm')}
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}
