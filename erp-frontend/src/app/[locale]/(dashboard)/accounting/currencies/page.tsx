'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { Btn, Card, Field, inputCls, todayIso, useLocalName } from '@/components/finance/ui';
import { byId, useCurrencies, useExchangeRates, useFinAction } from '@/hooks/use-finance';
import { finAccountingService, type Currency, type ExchangeRate } from '@/services/finance-accounting.service';

/** Currencies and the company's exchange rates (base-currency units per unit). */
export default function CurrenciesPage() {
  const t = useTranslations('acct');
  const tc = useTranslations('common');
  const name = useLocalName();
  const { data: currencies = [], isLoading } = useCurrencies();
  const { data: rates = [], isLoading: loadingRates } = useExchangeRates();
  const currenciesById = byId(currencies);
  const base = currencies.find((c) => c.isBase);
  const [currencyFilter, setCurrencyFilter] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ currencyId: '', rate: '', date: todayIso() });

  const latest = (currencyId: string) =>
    rates
      .filter((r) => r.currencyId === currencyId)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) || (a.tenantId ? 0 : 1) - (b.tenantId ? 0 : 1))[0];

  const create = useFinAction(
    () => finAccountingService.createExchangeRate({ currencyId: form.currencyId, rate: Number(form.rate), date: form.date }),
    { invalidate: ['fin-exchange-rates'], onSuccess: () => setOpen(false) },
  );

  const openNew = (currencyId = '') => {
    setForm({ currencyId: currencyId || currencies.find((c) => !c.isBase)?.id || '', rate: '', date: todayIso() });
    setOpen(true);
  };

  const currencyColumns = [
    { key: 'code', header: tc('code') },
    { key: 'nameAr', header: tc('name'), render: (c: Currency) => name(c) },
    { key: 'symbol', header: t('symbol') },
    {
      key: 'isBase',
      header: t('latestRate'),
      render: (c: Currency) => {
        if (c.isBase) return <span className="text-xs bg-primary-50 text-primary-700 rounded-full px-2 py-0.5">{t('baseCurrencyBadge')}</span>;
        const r = latest(c.id);
        return r ? (
          <span dir="ltr" className="tabular-nums">
            {Number(r.rate)} <span className="text-xs text-gray-500">({String(r.date).slice(0, 10)})</span>
          </span>
        ) : (
          <span className="text-xs text-amber-700">{t('noRateKnown')}</span>
        );
      },
    },
  ];

  const rateRows = rates.filter((r) => !currencyFilter || r.currencyId === currencyFilter);
  const rateColumns = [
    { key: 'date', header: tc('date'), render: (r: ExchangeRate) => String(r.date).slice(0, 10) },
    {
      key: 'currencyId',
      header: t('currency'),
      render: (r: ExchangeRate) => (currenciesById[r.currencyId] ? `${currenciesById[r.currencyId].code} - ${name(currenciesById[r.currencyId])}` : ''),
    },
    {
      key: 'rate',
      header: t('rateInBase', { base: base?.code ?? '' }),
      render: (r: ExchangeRate) => (
        <span dir="ltr" className="tabular-nums">
          {Number(r.rate)}
        </span>
      ),
    },
    {
      key: 'tenantId',
      header: t('rateSource'),
      render: (r: ExchangeRate) => (r.tenantId ? t('rateCompany') : t('rateShared')),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">{t('currenciesTitle')}</h1>
        <Btn onClick={() => openNew()}>{t('newExchangeRate')}</Btn>
      </div>
      <Card title={t('currencies')}>
        <DataTable
          columns={currencyColumns}
          data={currencies}
          loading={isLoading}
          actions={(c) =>
            c.isBase ? null : (
              <Btn size="sm" variant="ghost" onClick={() => openNew(c.id)}>
                {t('setRate')}
              </Btn>
            )
          }
        />
      </Card>
      <Card
        title={t('exchangeRates')}
        actions={
          <select className={inputCls + ' w-48'} value={currencyFilter} onChange={(e) => setCurrencyFilter(e.target.value)}>
            <option value="">{tc('all')}</option>
            {currencies
              .filter((c) => !c.isBase)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code}
                </option>
              ))}
          </select>
        }
      >
        <p className="text-xs text-gray-500 mb-3">{t('exchangeRatesHint')}</p>
        <DataTable columns={rateColumns} data={rateRows} loading={loadingRates} pageSize={20} />
      </Card>

      <Modal isOpen={open} onClose={() => setOpen(false)} title={t('newExchangeRate')} size="sm">
        <div className="space-y-4">
          <Field label={t('currency') + ' *'}>
            <select className={inputCls} value={form.currencyId} onChange={(e) => setForm({ ...form, currencyId: e.target.value })}>
              <option value="">-</option>
              {currencies
                .filter((c) => !c.isBase)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} - {name(c)}
                  </option>
                ))}
            </select>
          </Field>
          <Field label={tc('date') + ' *'}>
            <input type="date" className={inputCls} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </Field>
          <Field label={t('rateInBase', { base: base?.code ?? '' }) + ' *'} hint={t('rateHint')}>
            <input type="number" step="any" min="0" className={inputCls} value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} />
          </Field>
          <div className="flex justify-end gap-3">
            <Btn variant="secondary" onClick={() => setOpen(false)}>
              {tc('cancel')}
            </Btn>
            <Btn disabled={!form.currencyId || !(Number(form.rate) > 0) || !form.date || create.isPending} onClick={() => create.mutate(undefined)}>
              {tc('save')}
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}
