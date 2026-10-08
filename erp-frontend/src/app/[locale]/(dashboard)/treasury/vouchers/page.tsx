'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import StatusBadge from '@/components/ui/StatusBadge';
import ActionDialog from '@/components/finance/ActionDialog';
import AccountPicker, { useAccountLabel } from '@/components/finance/AccountPicker';
import { Btn, Field, Money, Tabs, Toolbar, fmtMoney, inputCls, todayIso, useLocalName } from '@/components/finance/ui';
import { byId, useBranches, useFinAction, useRateFor, useTreasuries } from '@/hooks/use-finance';
import { PrintButton } from '@/components/platform/PrintButton';
import { treasuryService, type Voucher, type VoucherType } from '@/services/finance-treasury.service';

type LineDraft = { accountId: string; amount: string; description: string };
const emptyLine = (): LineDraft => ({ accountId: '', amount: '', description: '' });

export default function VouchersPage() {
  const t = useTranslations('treasury');
  const tc = useTranslations('common');
  const tPl = useTranslations('platform');
  const name = useLocalName();
  const accountLabel = useAccountLabel();
  const { data: treasuries = [] } = useTreasuries(false);
  const { data: branches = [] } = useBranches();
  const treasuriesById = byId(treasuries);

  const [type, setType] = useState<'all' | VoucherType>('all');
  const [filters, setFilters] = useState({ treasuryId: '', from: '', to: '' });
  const { data: vouchers = [], isLoading } = useQuery({
    queryKey: ['vouchers', type, filters],
    queryFn: () => treasuryService.getVouchers({ ...filters, type: type === 'all' ? undefined : type }),
  });

  const [showNew, setShowNew] = useState(false);
  const [detail, setDetail] = useState<Voucher | null>(null);
  const [cancelling, setCancelling] = useState<Voucher | null>(null);
  const [form, setForm] = useState({
    type: 'payment' as VoucherType,
    treasuryId: '',
    date: todayIso(),
    exchangeRate: '',
    counterpartyName: '',
    reference: '',
    description: '',
    branchId: '',
  });
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const selectedTreasury = treasuriesById[form.treasuryId];
  const foreign = !!selectedTreasury?.currencyId;
  const suggestedRate = useRateFor(selectedTreasury?.currencyId, form.date);
  useEffect(() => {
    if (foreign && suggestedRate != null) setForm((f) => (f.exchangeRate ? f : { ...f, exchangeRate: String(suggestedRate) }));
  }, [foreign, suggestedRate, form.treasuryId]);

  const openNew = (vt: VoucherType) => {
    setForm({ type: vt, treasuryId: treasuries[0]?.id ?? '', date: todayIso(), exchangeRate: '', counterpartyName: '', reference: '', description: '', branchId: '' });
    setLines([emptyLine()]);
    setShowNew(true);
  };

  const create = useFinAction(
    (post: boolean) =>
      treasuryService.createVoucher({
        type: form.type,
        treasuryId: form.treasuryId,
        date: form.date,
        exchangeRate: foreign && form.exchangeRate ? Number(form.exchangeRate) : undefined,
        counterpartyName: form.counterpartyName || undefined,
        reference: form.reference || undefined,
        description: form.description || undefined,
        branchId: form.branchId || undefined,
        lines: lines.map((l) => ({ accountId: l.accountId, amount: Number(l.amount), description: l.description || undefined })),
        post,
      }),
    { invalidate: ['vouchers', 'treasuries', 'cash-book'], onSuccess: () => setShowNew(false) },
  );
  const post = useFinAction(treasuryService.postVoucher, { invalidate: ['vouchers', 'treasuries', 'cash-book'] });
  const cancel = useFinAction(({ id, data }: { id: string; data: { date?: string; reason?: string } }) => treasuryService.cancelVoucher(id, data), {
    invalidate: ['vouchers', 'treasuries', 'cash-book'],
    onSuccess: () => setCancelling(null),
  });

  const canSave = form.treasuryId && form.date && lines.length > 0 && lines.every((l) => l.accountId && Number(l.amount) > 0) && (!foreign || form.exchangeRate);

  const columns = [
    { key: 'voucherNumber', header: t('number') },
    { key: 'type', header: t('voucherType'), render: (v: Voucher) => t(`voucher_${v.type}`) },
    { key: 'date', header: tc('date') },
    { key: 'treasuryId', header: t('treasury'), render: (v: Voucher) => name(treasuriesById[v.treasuryId]) },
    { key: 'counterpartyName', header: t('counterparty') },
    { key: 'description', header: tc('description') },
    {
      key: 'amount',
      header: tc('amount'),
      render: (v: Voucher) => <Money value={v.amount} className={v.type === 'receipt' ? 'text-green-700' : 'text-red-700'} />,
    },
    { key: 'status', header: tc('status'), render: (v: Voucher) => <StatusBadge status={v.status} label={tc(v.status)} /> },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold text-gray-900">{t('vouchersTitle')}</h1>
        <div className="flex gap-2">
          <Btn variant="success" onClick={() => openNew('receipt')}>
            {t('newReceipt')}
          </Btn>
          <Btn variant="danger" onClick={() => openNew('payment')}>
            {t('newPayment')}
          </Btn>
        </div>
      </div>
      <Tabs
        tabs={[
          { key: 'all', label: tc('all') },
          { key: 'receipt', label: t('voucher_receipt') },
          { key: 'payment', label: t('voucher_payment') },
        ]}
        value={type}
        onChange={setType}
      />
      <Toolbar>
        <Field label={t('treasury')} className="w-56">
          <select className={inputCls} value={filters.treasuryId} onChange={(e) => setFilters({ ...filters, treasuryId: e.target.value })}>
            <option value="">{tc('all')}</option>
            {treasuries.map((tr) => (
              <option key={tr.id} value={tr.id}>
                {tr.code} - {name(tr)}
              </option>
            ))}
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
        data={vouchers}
        loading={isLoading}
        searchable
        onRowClick={setDetail}
        actions={(v) => (
          <div className="flex gap-1">
            <PrintButton path={`/print/treasury-vouchers/${v.id}`} label={tPl('print.pdf')} />
            {v.status === 'draft' && (
              <Btn size="sm" variant="ghost" onClick={() => post.mutate(v.id)} disabled={post.isPending}>
                {t('post')}
              </Btn>
            )}
            {v.status !== 'cancelled' && (
              <Btn size="sm" variant="ghost" onClick={() => setCancelling(v)}>
                {tc('cancel')}
              </Btn>
            )}
          </div>
        )}
      />

      <Modal isOpen={showNew} onClose={() => setShowNew(false)} title={form.type === 'receipt' ? t('newReceipt') : t('newPayment')} size="xl">
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Field label={t('treasury') + ' *'}>
              <select className={inputCls} value={form.treasuryId} onChange={(e) => setForm({ ...form, treasuryId: e.target.value })}>
                <option value="">-</option>
                {treasuries.filter((tr) => tr.isActive).map((tr) => (
                  <option key={tr.id} value={tr.id}>
                    {tr.code} - {name(tr)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={tc('date')}>
              <input type="date" className={inputCls} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </Field>
            <Field label={form.type === 'receipt' ? t('receivedFrom') : t('paidTo')}>
              <input className={inputCls} value={form.counterpartyName} onChange={(e) => setForm({ ...form, counterpartyName: e.target.value })} />
            </Field>
            <Field label={t('reference')}>
              <input className={inputCls} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
            </Field>
            {foreign && (
              <Field label={t('exchangeRate') + ' *'} hint={t('exchangeRateHint')}>
                <input type="number" step="any" className={inputCls} value={form.exchangeRate} onChange={(e) => setForm({ ...form, exchangeRate: e.target.value })} />
              </Field>
            )}
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
            <Field label={tc('description')} className="md:col-span-2">
              <input className={inputCls} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th className="text-start px-2 py-2 w-[40%]">{t('counterAccount')}</th>
                <th className="text-start px-2 py-2">{tc('description')}</th>
                <th className="text-start px-2 py-2 w-36">{tc('amount')}</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-b border-gray-100">
                  <td className="px-2 py-1.5">
                    <AccountPicker value={l.accountId} onChange={(id) => setLines((ls) => ls.map((x, idx) => (idx === i ? { ...x, accountId: id } : x)))} />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      className={inputCls}
                      value={l.description}
                      onChange={(e) => setLines((ls) => ls.map((x, idx) => (idx === i ? { ...x, description: e.target.value } : x)))}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      step="any"
                      className={inputCls}
                      value={l.amount}
                      onChange={(e) => setLines((ls) => ls.map((x, idx) => (idx === i ? { ...x, amount: e.target.value } : x)))}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      disabled={lines.length <= 1}
                      onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                      className="p-1 text-gray-400 hover:text-red-600 disabled:opacity-30"
                      aria-label={tc('delete')}
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="px-2 py-2">
                  <Btn size="sm" variant="ghost" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
                    <Plus size={14} /> {t('addLine')}
                  </Btn>
                </td>
                <td className="px-2 py-2 text-end">{tc('total')}</td>
                <td className="px-2 py-2 tabular-nums" dir="ltr">
                  {fmtMoney(total)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
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

      <Modal isOpen={!!detail} onClose={() => setDetail(null)} title={`${detail ? t(`voucher_${detail.type}`) : ''} ${detail?.voucherNumber ?? ''}`} size="lg">
        {detail && (
          <div className="space-y-3 text-sm">
            <p>
              {detail.date} · {name(treasuriesById[detail.treasuryId])} · {detail.counterpartyName}
            </p>
            {detail.description && <p className="text-gray-600">{detail.description}</p>}
            <table className="w-full">
              <tbody>
                {(detail.lines ?? []).map((l) => (
                  <tr key={l.id} className="border-b border-gray-100">
                    <td className="py-1.5">{accountLabel(l.accountId)}</td>
                    <td className="py-1.5">{l.description}</td>
                    <td className="py-1.5 text-end">
                      <Money value={l.amount} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-end font-semibold">
              {tc('total')}: <Money value={detail.amount} />
            </p>
          </div>
        )}
      </Modal>

      <ActionDialog
        open={!!cancelling}
        title={`${tc('cancel')} ${cancelling?.voucherNumber ?? ''}`}
        message={cancelling?.status === 'posted' ? t('cancelPostedHint') : undefined}
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
