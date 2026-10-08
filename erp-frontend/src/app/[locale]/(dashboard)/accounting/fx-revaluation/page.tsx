'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import StatusBadge from '@/components/ui/StatusBadge';
import { Btn, Card, Field, Money, apiError, inputCls, todayIso } from '@/components/finance/ui';
import { byId, useCurrencies, useExchangeRates, useFinAction } from '@/hooks/use-finance';
import { depthService, type FxItem, type FxPreview, type FxRevaluation } from '@/services/finance-depth.service';

function monthEnd(iso: string) {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Unrealised exchange differences at a period end, posted with an automatic reversal. */
export default function FxRevaluationPage() {
  const t = useTranslations('depth');
  const tc = useTranslations('common');
  const { data: currencies = [] } = useCurrencies();
  const { data: rates = [] } = useExchangeRates();
  const currenciesById = byId(currencies);
  const foreign = currencies.filter((c) => !c.isBase);
  const { data: history = [], isLoading } = useQuery({ queryKey: ['fx-revaluations'], queryFn: depthService.revaluations });

  const [date, setDate] = useState(monthEnd(todayIso()));
  const [reversalDate, setReversalDate] = useState('');
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<FxPreview | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [detail, setDetail] = useState<FxRevaluation | null>(null);
  const [reversing, setReversing] = useState<FxRevaluation | null>(null);
  const [reverseDate, setReverseDate] = useState('');

  const latestRate = (currencyId: string) =>
    rates
      .filter((r) => r.currencyId === currencyId && String(r.date).slice(0, 10) <= date)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];

  const body = () => ({
    date,
    reversalDate: reversalDate || undefined,
    rates: Object.entries(overrides)
      .filter(([, v]) => Number(v) > 0)
      .map(([currencyId, v]) => ({ currencyId, rate: Number(v) })),
  });

  const runPreview = async () => {
    setPreviewing(true);
    setPreviewError('');
    try {
      setPreview(await depthService.previewRevaluation(body()));
    } catch (err) {
      setPreview(null);
      setPreviewError(apiError(err, tc('error')));
    } finally {
      setPreviewing(false);
    }
  };

  const post = useFinAction(() => depthService.postRevaluation(body()), {
    invalidate: ['fx-revaluations', 'fin-journal-entries'],
    success: t('revaluationPosted'),
    onSuccess: () => setPreview(null),
  });
  const reverse = useFinAction(() => depthService.reverseRevaluation(reversing!.id, reverseDate || undefined), {
    invalidate: ['fx-revaluations', 'fin-journal-entries'],
    onSuccess: () => setReversing(null),
  });

  const itemColumns = [
    { key: 'kind', header: t('type'), render: (i: FxItem & { id: string }) => t(`fxkind_${i.kind}`) },
    { key: 'label', header: t('item') },
    { key: 'currencyCode', header: t('currency'), render: (i: FxItem & { id: string }) => i.currencyCode ?? currenciesById[i.currencyId]?.code },
    { key: 'foreignAmount', header: t('foreignAmount'), render: (i: FxItem & { id: string }) => <Money value={i.foreignAmount} /> },
    { key: 'bookedBase', header: t('bookedBase'), render: (i: FxItem & { id: string }) => <Money value={i.bookedBase} /> },
    { key: 'rate', header: t('rate'), render: (i: FxItem & { id: string }) => <span dir="ltr">{i.rate}</span> },
    { key: 'revaluedBase', header: t('revaluedBase'), render: (i: FxItem & { id: string }) => <Money value={i.revaluedBase} /> },
    {
      key: 'gainLoss',
      header: t('gainLoss'),
      render: (i: FxItem & { id: string }) => <Money value={i.gainLoss} className={i.gainLoss > 0 ? 'text-green-700' : ''} />,
    },
  ];
  const withIds = (items: FxItem[]) => items.map((i, idx) => ({ ...i, id: `${i.kind}-${i.currencyId}-${i.accountId ?? i.treasuryId ?? idx}-${idx}` }));

  const historyColumns = [
    { key: 'revaluationNumber', header: tc('code') },
    { key: 'date', header: tc('date') },
    { key: 'reversalDate', header: t('reversalDate') },
    { key: 'totalGain', header: t('totalGain'), render: (r: FxRevaluation) => <Money value={r.totalGain} /> },
    { key: 'totalLoss', header: t('totalLoss'), render: (r: FxRevaluation) => <Money value={r.totalLoss} /> },
    {
      key: 'status',
      header: tc('status'),
      render: (r: FxRevaluation) => <StatusBadge status={r.status === 'posted' ? 'posted' : 'cancelled'} label={t(`fxstatus_${r.status}`)} />,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('fxTitle')}</h1>
        <p className="text-sm text-gray-500">{t('fxIntro')}</p>
      </div>

      <Card title={t('newRevaluation')}>
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <Field label={t('revaluationDate') + ' *'}>
            <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={t('reversalDate')} hint={t('reversalDateHint')}>
            <input type="date" className={inputCls} value={reversalDate} onChange={(e) => setReversalDate(e.target.value)} />
          </Field>
        </div>
        {foreign.length > 0 && (
          <div className="mb-4">
            <p className="text-sm font-medium mb-2">{t('ratesToUse')}</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {foreign.map((c) => {
                const r = latestRate(c.id);
                return (
                  <Field key={c.id} label={c.code} hint={r ? t('rateOnFile', { rate: Number(r.rate), date: String(r.date).slice(0, 10) }) : t('noRateOnFile')}>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      className={inputCls}
                      placeholder={r ? String(Number(r.rate)) : ''}
                      value={overrides[c.id] ?? ''}
                      onChange={(e) => setOverrides({ ...overrides, [c.id]: e.target.value })}
                    />
                  </Field>
                );
              })}
            </div>
          </div>
        )}
        <div className="flex gap-2">
          <Btn variant="secondary" disabled={!date || previewing} onClick={runPreview}>
            {previewing ? tc('loading') : t('preview')}
          </Btn>
          <Btn disabled={!preview || !preview.items.length || post.isPending} onClick={() => post.mutate(undefined)}>
            {t('postRevaluation')}
          </Btn>
        </div>
        {previewError && <p className="mt-3 text-sm text-red-600 bg-red-50 rounded-lg p-3">{previewError}</p>}
        {preview && (
          <div className="mt-4 space-y-3">
            {preview.warnings.length > 0 && (
              <ul className="text-sm text-amber-800 bg-amber-50 rounded-lg p-3 list-disc ps-6">
                {preview.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div className="bg-green-50 rounded-lg p-3">
                {t('totalGain')}: <Money value={preview.totalGain} />
              </div>
              <div className="bg-red-50 rounded-lg p-3">
                {t('totalLoss')}: <Money value={preview.totalLoss} />
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                {t('net')}: <Money value={preview.net} />
                <span className="text-xs text-gray-500 ms-2">
                  {t('reversalOn', { date: preview.reversalDate })}
                </span>
              </div>
            </div>
            {preview.items.length ? <DataTable columns={itemColumns} data={withIds(preview.items)} pageSize={50} /> : <p className="text-sm text-gray-500">{t('nothingToRevalue')}</p>}
          </div>
        )}
      </Card>

      <Card title={t('revaluationHistory')}>
        <DataTable
          columns={historyColumns}
          data={history}
          loading={isLoading}
          onRowClick={setDetail}
          actions={(r) =>
            r.status === 'posted' ? (
              <Btn
                size="sm"
                variant="ghost"
                onClick={() => {
                  setReverseDate('');
                  setReversing(r);
                }}
              >
                {t('reverse')}
              </Btn>
            ) : null
          }
        />
      </Card>

      <Modal isOpen={!!detail} onClose={() => setDetail(null)} title={detail?.revaluationNumber ?? ''} size="xl">
        {detail && <DataTable columns={itemColumns} data={withIds(detail.items ?? [])} pageSize={50} />}
      </Modal>

      <Modal isOpen={!!reversing} onClose={() => setReversing(null)} title={`${t('reverse')} ${reversing?.revaluationNumber ?? ''}`} size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">{t('reverseHint')}</p>
          <Field label={tc('date')}>
            <input type="date" className={inputCls} value={reverseDate} onChange={(e) => setReverseDate(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-3">
            <Btn variant="secondary" onClick={() => setReversing(null)}>
              {tc('back')}
            </Btn>
            <Btn variant="danger" disabled={reverse.isPending} onClick={() => reverse.mutate(undefined)}>
              {tc('confirm')}
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}
