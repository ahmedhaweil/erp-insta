'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import StatusBadge from '@/components/ui/StatusBadge';
import ActionDialog from '@/components/finance/ActionDialog';
import { Btn, Field, Money, Toolbar, inputCls, todayIso, useLocalName } from '@/components/finance/ui';
import { byId, useFinAction, useRateFor, useTreasuries } from '@/hooks/use-finance';
import { treasuryService, type Transfer } from '@/services/finance-treasury.service';

const emptyForm = { fromTreasuryId: '', toTreasuryId: '', date: todayIso(), amount: '', rate: '', toAmount: '', baseRate: '', fee: '', reference: '', description: '' };

export default function TransfersPage() {
  const t = useTranslations('treasury');
  const tc = useTranslations('common');
  const name = useLocalName();
  const { data: treasuries = [] } = useTreasuries(true);
  const byTreasury = byId(treasuries);
  const [filters, setFilters] = useState({ treasuryId: '', from: '', to: '' });
  const { data: transfers = [], isLoading } = useQuery({
    queryKey: ['transfers', filters],
    queryFn: () => treasuryService.getTransfers(filters),
  });

  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [cancelling, setCancelling] = useState<Transfer | null>(null);
  const set = (k: keyof typeof emptyForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const fromT = byTreasury[form.fromTreasuryId];
  const toT = byTreasury[form.toTreasuryId];
  const crossCurrency = !!fromT && !!toT && (fromT.currencyId ?? null) !== (toT.currencyId ?? null);
  const fromForeign = !!fromT?.currencyId;
  // Suggestions from the exchange-rate table: base rate of the source currency and,
  // across currencies, the source -> destination rate (both via the base currency).
  const fromRate = useRateFor(fromT?.currencyId, form.date);
  const toRate = useRateFor(toT?.currencyId, form.date);
  const fromBase = fromT?.currencyId ? fromRate : 1;
  const toBase = toT?.currencyId ? toRate : 1;
  const crossRate = fromBase != null && toBase ? Math.round((fromBase / toBase) * 1e6) / 1e6 : undefined;
  useEffect(() => {
    if (fromForeign && fromRate != null) setForm((f) => (f.baseRate ? f : { ...f, baseRate: String(fromRate) }));
  }, [fromForeign, fromRate, form.fromTreasuryId]);
  useEffect(() => {
    if (crossCurrency && crossRate != null) setForm((f) => (f.rate || f.toAmount ? f : { ...f, rate: String(crossRate) }));
  }, [crossCurrency, crossRate, form.fromTreasuryId, form.toTreasuryId]);

  const create = useFinAction(
    (post: boolean) => {
      const num = (v: string) => (v === '' ? undefined : Number(v));
      return treasuryService.createTransfer({
        fromTreasuryId: form.fromTreasuryId,
        toTreasuryId: form.toTreasuryId,
        date: form.date,
        amount: Number(form.amount),
        rate: crossCurrency ? num(form.rate) : undefined,
        toAmount: crossCurrency ? num(form.toAmount) : undefined,
        baseRate: fromForeign ? num(form.baseRate) : undefined,
        fee: num(form.fee),
        reference: form.reference || undefined,
        description: form.description || undefined,
        post,
      });
    },
    {
      invalidate: ['transfers', 'treasuries', 'cash-book'],
      onSuccess: () => {
        setShowNew(false);
        setForm(emptyForm);
      },
    },
  );
  const post = useFinAction(treasuryService.postTransfer, { invalidate: ['transfers', 'treasuries', 'cash-book'] });
  const cancel = useFinAction(({ id, data }: { id: string; data: { date?: string; reason?: string } }) => treasuryService.cancelTransfer(id, data), {
    invalidate: ['transfers', 'treasuries', 'cash-book'],
    onSuccess: () => setCancelling(null),
  });

  const canSave =
    form.fromTreasuryId &&
    form.toTreasuryId &&
    form.fromTreasuryId !== form.toTreasuryId &&
    Number(form.amount) > 0 &&
    (!crossCurrency || form.rate || form.toAmount);

  const tName = (id: string) => {
    const tr = byTreasury[id];
    return tr ? `${tr.code} - ${name(tr)}` : '';
  };

  const columns = [
    { key: 'transferNumber', header: t('number') },
    { key: 'date', header: tc('date') },
    { key: 'fromTreasuryId', header: t('fromTreasury'), render: (x: Transfer) => tName(x.fromTreasuryId) },
    { key: 'toTreasuryId', header: t('toTreasury'), render: (x: Transfer) => tName(x.toTreasuryId) },
    { key: 'amount', header: tc('amount'), render: (x: Transfer) => <Money value={x.amount} /> },
    { key: 'toAmount', header: t('toAmount'), render: (x: Transfer) => <Money value={x.toAmount} /> },
    { key: 'fee', header: t('fee'), render: (x: Transfer) => (Number(x.fee) ? <Money value={x.fee} /> : '') },
    { key: 'status', header: tc('status'), render: (x: Transfer) => <StatusBadge status={x.status} label={tc(x.status)} /> },
  ];

  const options = treasuries
    .filter((tr) => tr.isActive)
    .map((tr) => (
      <option key={tr.id} value={tr.id}>
        {tr.code} - {name(tr)} ({t(`type_${tr.type}`)})
      </option>
    ));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold text-gray-900">{t('transfersTitle')}</h1>
        <Btn onClick={() => setShowNew(true)}>{t('newTransfer')}</Btn>
      </div>
      <Toolbar>
        <Field label={t('treasury')} className="w-56">
          <select className={inputCls} value={filters.treasuryId} onChange={(e) => setFilters({ ...filters, treasuryId: e.target.value })}>
            <option value="">{tc('all')}</option>
            {options}
          </select>
        </Field>
        <Field label={t('from')}>
          <input type="date" className={inputCls} value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        </Field>
        <Field label={t('to')}>
          <input type="date" className={inputCls} value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        </Field>
      </Toolbar>
      <DataTable
        columns={columns}
        data={transfers}
        loading={isLoading}
        searchable
        actions={(x) => (
          <div className="flex gap-1">
            {x.status === 'draft' && (
              <Btn size="sm" variant="ghost" onClick={() => post.mutate(x.id)} disabled={post.isPending}>
                {t('post')}
              </Btn>
            )}
            {x.status !== 'cancelled' && (
              <Btn size="sm" variant="ghost" onClick={() => setCancelling(x)}>
                {tc('cancel')}
              </Btn>
            )}
          </div>
        )}
      />

      <Modal isOpen={showNew} onClose={() => setShowNew(false)} title={t('newTransfer')} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label={t('fromTreasury') + ' *'} hint={fromT ? `${t('balance')}: ${Number(fromT.balance ?? 0).toFixed(2)}` : undefined}>
              <select className={inputCls} value={form.fromTreasuryId} onChange={(e) => set('fromTreasuryId', e.target.value)}>
                <option value="">-</option>
                {options}
              </select>
            </Field>
            <Field label={t('toTreasury') + ' *'}>
              <select className={inputCls} value={form.toTreasuryId} onChange={(e) => set('toTreasuryId', e.target.value)}>
                <option value="">-</option>
                {options}
              </select>
            </Field>
            <Field label={tc('date')}>
              <input type="date" className={inputCls} value={form.date} onChange={(e) => set('date', e.target.value)} />
            </Field>
            <Field label={tc('amount') + ' *'}>
              <input type="number" step="any" className={inputCls} value={form.amount} onChange={(e) => set('amount', e.target.value)} />
            </Field>
            {crossCurrency && (
              <>
                <Field label={t('transferRate')} hint={t('transferRateHint')}>
                  <input type="number" step="any" className={inputCls} value={form.rate} onChange={(e) => set('rate', e.target.value)} />
                </Field>
                <Field label={t('toAmount')}>
                  <input type="number" step="any" className={inputCls} value={form.toAmount} onChange={(e) => set('toAmount', e.target.value)} />
                </Field>
              </>
            )}
            {fromForeign && (
              <Field label={t('baseRate')} hint={t('exchangeRateHint')}>
                <input type="number" step="any" className={inputCls} value={form.baseRate} onChange={(e) => set('baseRate', e.target.value)} />
              </Field>
            )}
            <Field label={t('fee')} hint={t('feeHint')}>
              <input type="number" step="any" className={inputCls} value={form.fee} onChange={(e) => set('fee', e.target.value)} />
            </Field>
            <Field label={t('reference')}>
              <input className={inputCls} value={form.reference} onChange={(e) => set('reference', e.target.value)} />
            </Field>
            <Field label={tc('description')}>
              <input className={inputCls} value={form.description} onChange={(e) => set('description', e.target.value)} />
            </Field>
          </div>
          <div className="flex justify-end gap-3">
            <Btn variant="secondary" onClick={() => setShowNew(false)}>
              {tc('cancel')}
            </Btn>
            <Btn variant="secondary" disabled={!canSave || create.isPending} onClick={() => create.mutate(false)}>
              {t('saveDraft')}
            </Btn>
            <Btn disabled={!canSave || create.isPending} onClick={() => create.mutate(true)}>
              {t('saveAndPost')}
            </Btn>
          </div>
        </div>
      </Modal>

      <ActionDialog
        open={!!cancelling}
        title={`${tc('cancel')} ${cancelling?.transferNumber ?? ''}`}
        fields={[
          { name: 'date', label: t('reversalDate'), type: 'date', defaultValue: todayIso() },
          { name: 'reason', label: t('reason'), type: 'text' },
        ]}
        destructive
        loading={cancel.isPending}
        onClose={() => setCancelling(null)}
        onSubmit={(v) => cancelling && cancel.mutate({ id: cancelling.id, data: v })}
      />
    </div>
  );
}
