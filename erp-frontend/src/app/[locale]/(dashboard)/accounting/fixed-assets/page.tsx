'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import StatusBadge from '@/components/ui/StatusBadge';
import ActionDialog from '@/components/finance/ActionDialog';
import AccountPicker from '@/components/finance/AccountPicker';
import { ReportTable } from '@/components/finance/ReportTable';
import { Btn, Field, Money, Spinner, inputCls, todayIso } from '@/components/finance/ui';
import { useFinAction } from '@/hooks/use-finance';
import { finAccountingService, type FixedAsset } from '@/services/finance-accounting.service';

const emptyForm = {
  code: '',
  name: '',
  purchaseDate: todayIso(),
  purchaseValue: '',
  usefulLifeMonths: '60',
  depreciationMethod: 'straight_line',
  salvageValue: '',
  decliningRate: '',
  accountId: '',
  depreciationExpenseAccountId: '',
  accumulatedDepreciationAccountId: '',
};

export default function FixedAssetsPage() {
  const t = useTranslations('acct');
  const tc = useTranslations('common');
  const { data: assets = [], isLoading } = useQuery({ queryKey: ['fixed-assets'], queryFn: finAccountingService.getFixedAssets });
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [scheduleFor, setScheduleFor] = useState<FixedAsset | null>(null);
  const [disposing, setDisposing] = useState<FixedAsset | null>(null);
  const [showRun, setShowRun] = useState(false);

  const { data: schedule = [], isFetching: loadingSchedule } = useQuery({
    queryKey: ['asset-schedule', scheduleFor?.id],
    queryFn: () => finAccountingService.getSchedule(scheduleFor!.id),
    enabled: !!scheduleFor,
  });

  const create = useFinAction(finAccountingService.createFixedAsset, {
    invalidate: ['fixed-assets'],
    onSuccess: () => {
      setShowNew(false);
      setForm(emptyForm);
    },
  });
  const run = useFinAction((asOf?: string) => finAccountingService.runDepreciation(asOf), {
    invalidate: ['fixed-assets', 'asset-schedule', 'fin-journal-entries'],
    onSuccess: (r) => {
      setShowRun(false);
    },
    success: t('depreciationPosted'),
  });
  const dispose = useFinAction(({ id, data }: { id: string; data: { date: string; saleAmount?: number } }) => finAccountingService.disposeAsset(id, data), {
    invalidate: ['fixed-assets', 'fin-journal-entries'],
    onSuccess: () => setDisposing(null),
  });

  const submit = () => {
    const num = (v: string) => (v === '' ? undefined : Number(v));
    create.mutate({
      code: form.code,
      name: form.name,
      purchaseDate: form.purchaseDate,
      purchaseValue: Number(form.purchaseValue),
      usefulLifeMonths: Number(form.usefulLifeMonths),
      depreciationMethod: form.depreciationMethod,
      salvageValue: num(form.salvageValue),
      decliningRate: form.depreciationMethod === 'declining_balance' ? num(form.decliningRate) : undefined,
      accountId: form.accountId || undefined,
      depreciationExpenseAccountId: form.depreciationExpenseAccountId || undefined,
      accumulatedDepreciationAccountId: form.accumulatedDepreciationAccountId || undefined,
    });
  };

  const bookValue = (a: FixedAsset) => Number(a.purchaseValue) - Number(a.accumulatedDepreciation);

  const columns = [
    { key: 'code', header: tc('code') },
    { key: 'name', header: tc('name') },
    { key: 'purchaseDate', header: t('purchaseDate') },
    { key: 'purchaseValue', header: t('purchaseValue'), render: (a: FixedAsset) => <Money value={a.purchaseValue} /> },
    { key: 'accumulatedDepreciation', header: t('accumulatedDepreciation'), render: (a: FixedAsset) => <Money value={a.accumulatedDepreciation} /> },
    { key: 'bookValue', header: t('bookValue'), render: (a: FixedAsset) => <Money value={bookValue(a)} /> },
    { key: 'depreciationMethod', header: t('method'), render: (a: FixedAsset) => t(`method_${a.depreciationMethod}`) },
    { key: 'lastDepreciationDate', header: t('lastDepreciation') },
    {
      key: 'isDisposed',
      header: tc('status'),
      render: (a: FixedAsset) => (
        <StatusBadge status={a.isDisposed ? 'closed' : 'active'} label={a.isDisposed ? t('disposed') : tc('active')} />
      ),
    },
  ];

  const set = (k: keyof typeof emptyForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('fixedAssetsTitle')}</h1>
        <div className="flex gap-2">
          <Btn variant="secondary" onClick={() => setShowRun(true)}>
            {t('runDepreciation')}
          </Btn>
          <Btn onClick={() => setShowNew(true)}>{t('newAsset')}</Btn>
        </div>
      </div>
      <DataTable
        columns={columns}
        data={assets}
        loading={isLoading}
        searchable
        actions={(a) => (
          <div className="flex gap-1">
            <Btn size="sm" variant="ghost" onClick={() => setScheduleFor(a)}>
              {t('schedule')}
            </Btn>
            {!a.isDisposed && (
              <Btn size="sm" variant="ghost" onClick={() => setDisposing(a)}>
                {t('dispose')}
              </Btn>
            )}
          </div>
        )}
      />

      <Modal isOpen={showNew} onClose={() => setShowNew(false)} title={t('newAsset')} size="xl">
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label={tc('code') + ' *'}>
              <input className={inputCls} value={form.code} onChange={(e) => set('code', e.target.value)} />
            </Field>
            <Field label={tc('name') + ' *'} className="md:col-span-2">
              <input className={inputCls} value={form.name} onChange={(e) => set('name', e.target.value)} />
            </Field>
            <Field label={t('purchaseDate') + ' *'}>
              <input type="date" className={inputCls} value={form.purchaseDate} onChange={(e) => set('purchaseDate', e.target.value)} />
            </Field>
            <Field label={t('purchaseValue') + ' *'}>
              <input type="number" step="any" className={inputCls} value={form.purchaseValue} onChange={(e) => set('purchaseValue', e.target.value)} />
            </Field>
            <Field label={t('usefulLifeMonths') + ' *'}>
              <input type="number" className={inputCls} value={form.usefulLifeMonths} onChange={(e) => set('usefulLifeMonths', e.target.value)} />
            </Field>
            <Field label={t('method')}>
              <select className={inputCls} value={form.depreciationMethod} onChange={(e) => set('depreciationMethod', e.target.value)}>
                <option value="straight_line">{t('method_straight_line')}</option>
                <option value="declining_balance">{t('method_declining_balance')}</option>
              </select>
            </Field>
            <Field label={t('salvageValue')}>
              <input type="number" step="any" className={inputCls} value={form.salvageValue} onChange={(e) => set('salvageValue', e.target.value)} />
            </Field>
            {form.depreciationMethod === 'declining_balance' && (
              <Field label={t('decliningRate')}>
                <input type="number" step="any" className={inputCls} value={form.decliningRate} onChange={(e) => set('decliningRate', e.target.value)} />
              </Field>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label={t('assetAccount')}>
              <AccountPicker value={form.accountId} onChange={(id) => set('accountId', id)} types={['asset']} />
            </Field>
            <Field label={t('acc_depreciationExpense')} hint={t('defaultFromSettings')}>
              <AccountPicker value={form.depreciationExpenseAccountId} onChange={(id) => set('depreciationExpenseAccountId', id)} types={['expense']} />
            </Field>
            <Field label={t('acc_accumulatedDepreciation')} hint={t('defaultFromSettings')}>
              <AccountPicker value={form.accumulatedDepreciationAccountId} onChange={(id) => set('accumulatedDepreciationAccountId', id)} types={['asset']} />
            </Field>
          </div>
          <div className="flex justify-end gap-3">
            <Btn variant="secondary" onClick={() => setShowNew(false)}>
              {tc('cancel')}
            </Btn>
            <Btn
              onClick={submit}
              disabled={create.isPending || !form.code || !form.name || !form.purchaseValue || !Number(form.usefulLifeMonths)}
            >
              {tc('save')}
            </Btn>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!scheduleFor} onClose={() => setScheduleFor(null)} title={`${t('schedule')} - ${scheduleFor?.code ?? ''} ${scheduleFor?.name ?? ''}`} size="xl">
        {loadingSchedule ? (
          <Spinner />
        ) : (
          <ReportTable
            section={{
              columns: [
                { key: 'date', label: tc('date'), type: 'date' },
                { key: 'amount', label: t('depreciation'), type: 'money' },
                { key: 'accumulated', label: t('accumulatedDepreciation'), type: 'money' },
                { key: 'bookValue', label: t('bookValue'), type: 'money' },
                { key: 'posted', label: tc('posted'), render: (r) => (r.posted ? tc('yes') : tc('no')) },
              ],
              rows: schedule,
              rowClass: (r) => (r.posted ? 'bg-green-50/50' : undefined),
            }}
          />
        )}
      </Modal>

      <ActionDialog
        open={showRun}
        title={t('runDepreciation')}
        message={t('runDepreciationHint')}
        fields={[{ name: 'asOf', label: t('asOf'), type: 'date', required: true, defaultValue: todayIso() }]}
        loading={run.isPending}
        onClose={() => setShowRun(false)}
        onSubmit={(v) => run.mutate(v.asOf)}
      />
      <ActionDialog
        open={!!disposing}
        title={`${t('dispose')} - ${disposing?.name ?? ''}`}
        message={t('disposeHint')}
        fields={[
          { name: 'date', label: tc('date'), type: 'date', required: true, defaultValue: todayIso() },
          { name: 'saleAmount', label: t('saleAmount'), type: 'number', defaultValue: 0 },
        ]}
        destructive
        loading={dispose.isPending}
        onClose={() => setDisposing(null)}
        onSubmit={(v) => disposing && dispose.mutate({ id: disposing.id, data: v as any })}
      />
    </div>
  );
}
