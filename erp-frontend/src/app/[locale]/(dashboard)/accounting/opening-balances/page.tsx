'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import DataTable from '@/components/ui/DataTable';
import AccountPicker from '@/components/finance/AccountPicker';
import LinesEditor, { drCrPayload, drCrTotals, emptyDrCr, type DrCrLine } from '@/components/finance/LinesEditor';
import { Btn, Card, Field, Money, Tabs, fmtMoney, inputCls, todayIso, useLocalName } from '@/components/finance/ui';
import { Link } from '@/i18n/navigation';
import { byId, useCurrencies, useCustomersLookup, useFinAction, useSuppliersLookup } from '@/hooks/use-finance';
import { depthService, type OpeningBalance } from '@/services/finance-depth.service';

type PartnerRow = { partnerType: 'customer' | 'supplier'; partnerId: string; amount: string; dueDate: string; reference: string; currencyId: string; exchangeRate: string };
const emptyPartner = (partnerType: 'customer' | 'supplier' = 'customer'): PartnerRow => ({
  partnerType,
  partnerId: '',
  amount: '',
  dueDate: '',
  reference: '',
  currencyId: '',
  exchangeRate: '',
});

/** Opening balances when starting on the system: GL accounts and open customer / supplier balances. */
export default function OpeningBalancesPage() {
  const t = useTranslations('depth');
  const tc = useTranslations('common');
  const name = useLocalName();
  const { data: customers = [] } = useCustomersLookup();
  const { data: suppliers = [] } = useSuppliersLookup();
  const { data: currencies = [] } = useCurrencies();
  const partners = { ...byId(customers), ...byId(suppliers) };
  const [tab, setTab] = useState<'accounts' | 'partners' | 'history'>('accounts');
  const { data: history = [], isLoading } = useQuery({ queryKey: ['opening-balances'], queryFn: () => depthService.openings() });

  // accounts
  const [acc, setAcc] = useState({ date: todayIso(), equityAccountId: '', description: '', allowControlAccounts: false });
  const [lines, setLines] = useState<DrCrLine[]>([emptyDrCr()]);
  const totals = drCrTotals(lines);
  const postAccounts = useFinAction(
    () =>
      depthService.postOpeningAccounts({
        date: acc.date,
        equityAccountId: acc.equityAccountId || undefined,
        description: acc.description || undefined,
        allowControlAccounts: acc.allowControlAccounts || undefined,
        lines: drCrPayload(lines),
      }),
    {
      invalidate: ['opening-balances', 'fin-journal-entries'],
      success: t('openingPosted'),
      onSuccess: () => setLines([emptyDrCr()]),
    },
  );

  // partners
  const [par, setPar] = useState({ date: todayIso(), equityAccountId: '' });
  const [rows, setRows] = useState<PartnerRow[]>([emptyPartner()]);
  const setRow = (i: number, patch: Partial<PartnerRow>) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const partnerValid = rows.length > 0 && rows.every((r) => r.partnerId && Number(r.amount) !== 0 && (!r.currencyId || Number(r.exchangeRate) > 0));
  const postPartners = useFinAction(
    () =>
      depthService.postOpeningPartners({
        date: par.date,
        equityAccountId: par.equityAccountId || undefined,
        documents: rows.map((r) => ({
          partnerType: r.partnerType,
          partnerId: r.partnerId,
          amount: Number(r.amount),
          dueDate: r.dueDate || undefined,
          reference: r.reference || undefined,
          currencyId: r.currencyId || undefined,
          exchangeRate: r.currencyId ? Number(r.exchangeRate) : undefined,
        })),
      }),
    {
      invalidate: ['opening-balances', 'fin-journal-entries', 'open-invoices'],
      success: t('openingPosted'),
      onSuccess: () => setRows([emptyPartner()]),
    },
  );

  const historyColumns = [
    { key: 'date', header: tc('date') },
    { key: 'kind', header: t('type'), render: (o: OpeningBalance) => t(`okind_${o.kind}`) },
    { key: 'partnerId', header: t('partner'), render: (o: OpeningBalance) => (o.partnerId ? name(partners[o.partnerId]) : '') },
    { key: 'documentNumber', header: t('document') },
    { key: 'amount', header: tc('amount'), render: (o: OpeningBalance) => <Money value={o.amount} /> },
    { key: 'description', header: tc('description') },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('openingTitle')}</h1>
        <p className="text-sm text-gray-500">
          {t('openingIntro')}{' '}
          <Link href="/settings/import" className="text-primary-600 underline">
            {t('openingImportLink')}
          </Link>
        </p>
      </div>
      <Tabs
        tabs={[
          { key: 'accounts', label: t('openingAccounts') },
          { key: 'partners', label: t('openingPartners') },
          { key: 'history', label: t('openingHistory') },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'accounts' && (
        <Card>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <Field label={tc('date') + ' *'}>
              <input type="date" className={inputCls} value={acc.date} onChange={(e) => setAcc({ ...acc, date: e.target.value })} />
            </Field>
            <Field label={t('equityAccount')} hint={t('equityAccountHint')}>
              <AccountPicker value={acc.equityAccountId} onChange={(id) => setAcc({ ...acc, equityAccountId: id })} />
            </Field>
            <Field label={tc('description')}>
              <input className={inputCls} value={acc.description} onChange={(e) => setAcc({ ...acc, description: e.target.value })} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm mb-3">
            <input type="checkbox" checked={acc.allowControlAccounts} onChange={(e) => setAcc({ ...acc, allowControlAccounts: e.target.checked })} />
            {t('allowControlAccounts')}
          </label>
          <LinesEditor lines={lines} onChange={setLines} showBalance={false} />
          <p className="text-sm text-gray-600 mt-2">
            {t('differenceToEquity', { amount: fmtMoney(totals.diff) })}
          </p>
          <div className="flex justify-end mt-4">
            <Btn
              disabled={!acc.date || !lines.every((l) => l.accountId && (Number(l.debit) > 0) !== (Number(l.credit) > 0)) || postAccounts.isPending}
              onClick={() => postAccounts.mutate(undefined)}
            >
              {t('postOpening')}
            </Btn>
          </div>
        </Card>
      )}

      {tab === 'partners' && (
        <Card>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <Field label={tc('date') + ' *'}>
              <input type="date" className={inputCls} value={par.date} onChange={(e) => setPar({ ...par, date: e.target.value })} />
            </Field>
            <Field label={t('equityAccount')} hint={t('equityAccountHint')}>
              <AccountPicker value={par.equityAccountId} onChange={(id) => setPar({ ...par, equityAccountId: id })} />
            </Field>
          </div>
          <p className="text-xs text-gray-500 mb-2">{t('partnerAmountHint')}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-start px-2 py-2 w-32">{t('type')}</th>
                  <th className="text-start px-2 py-2">{t('partner')}</th>
                  <th className="text-start px-2 py-2 w-32">{tc('amount')}</th>
                  <th className="text-start px-2 py-2 w-36">{t('dueDate')}</th>
                  <th className="text-start px-2 py-2 w-32">{t('reference')}</th>
                  <th className="text-start px-2 py-2 w-28">{t('currency')}</th>
                  <th className="text-start px-2 py-2 w-24">{t('rate')}</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="px-2 py-1.5">
                      <select className={inputCls} value={r.partnerType} onChange={(e) => setRow(i, { partnerType: e.target.value as any, partnerId: '' })}>
                        <option value="customer">{t('customer')}</option>
                        <option value="supplier">{t('supplier')}</option>
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <select className={inputCls} value={r.partnerId} onChange={(e) => setRow(i, { partnerId: e.target.value })}>
                        <option value="">-</option>
                        {(r.partnerType === 'customer' ? customers : suppliers).map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.code} - {name(p)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <input type="number" step="any" className={inputCls} value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value })} />
                    </td>
                    <td className="px-2 py-1.5">
                      <input type="date" className={inputCls} value={r.dueDate} onChange={(e) => setRow(i, { dueDate: e.target.value })} />
                    </td>
                    <td className="px-2 py-1.5">
                      <input className={inputCls} value={r.reference} onChange={(e) => setRow(i, { reference: e.target.value })} />
                    </td>
                    <td className="px-2 py-1.5">
                      <select className={inputCls} value={r.currencyId} onChange={(e) => setRow(i, { currencyId: e.target.value })}>
                        <option value="">-</option>
                        {currencies
                          .filter((c) => !c.isBase)
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.code}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        step="any"
                        disabled={!r.currencyId}
                        className={inputCls}
                        value={r.exchangeRate}
                        onChange={(e) => setRow(i, { exchangeRate: e.target.value })}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <button
                        type="button"
                        disabled={rows.length <= 1}
                        onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}
                        className="p-1 text-gray-400 hover:text-red-600 disabled:opacity-30"
                        aria-label={tc('delete')}
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between mt-3">
            <Btn size="sm" variant="ghost" onClick={() => setRows((rs) => [...rs, emptyPartner(rs[rs.length - 1]?.partnerType)])}>
              <Plus size={14} /> {t('addRow')}
            </Btn>
            <Btn disabled={!par.date || !partnerValid || postPartners.isPending} onClick={() => postPartners.mutate(undefined)}>
              {t('postOpening')}
            </Btn>
          </div>
        </Card>
      )}

      {tab === 'history' && <DataTable columns={historyColumns} data={history} loading={isLoading} searchable pageSize={25} />}
    </div>
  );
}
