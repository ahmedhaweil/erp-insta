'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import StatusBadge from '@/components/ui/StatusBadge';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import AllocationEditor, { allocationsFrom } from '@/components/finance/AllocationEditor';
import { Btn, Field, Money, Tabs, Toolbar, inputCls, todayIso, useLocalName } from '@/components/finance/ui';
import { byId, useCustomersLookup, useFinAction, useSuppliersLookup, useTreasuries } from '@/hooks/use-finance';
import { treasuryService, type CreatePaymentPayload, type PaymentMethod, type PaymentRow } from '@/services/finance-treasury.service';

type PartnerType = 'customer' | 'supplier';
type AllocMode = 'auto' | 'manual' | 'none';

const emptyForm = {
  partnerType: 'customer' as PartnerType,
  partnerId: '',
  refund: false,
  date: todayIso(),
  amount: '',
  method: 'cash' as PaymentMethod,
  treasuryId: '',
  exchangeRate: '',
  withholdingAmount: '',
  reference: '',
  chequeSource: 'new' as 'new' | 'endorse',
  endorsedChequeId: '',
  chequeNumber: '',
  bankName: '',
  bankBranch: '',
  drawer: '',
  dueDate: todayIso(),
  chequeNotes: '',
  allocMode: 'auto' as AllocMode,
};

export default function PaymentsPage() {
  const t = useTranslations('payments');
  const tt = useTranslations('treasury');
  const tc = useTranslations('common');
  const name = useLocalName();
  const { data: customers = [] } = useCustomersLookup();
  const { data: suppliers = [] } = useSuppliersLookup();
  const { data: treasuries = [] } = useTreasuries(true);
  const partners = { ...byId(customers), ...byId(suppliers) };
  const treasuriesById = byId(treasuries);

  const [tab, setTab] = useState<'all' | PartnerType>('all');
  const [filters, setFilters] = useState({ partnerId: '', treasuryId: '' });
  const { data: payments = [], isLoading } = useQuery({ queryKey: ['payments', filters], queryFn: () => treasuryService.getPayments(filters) });
  const rows = payments.filter((p) => tab === 'all' || p.partnerType === tab);

  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [manual, setManual] = useState<Record<string, string>>({});
  const [allocating, setAllocating] = useState<PaymentRow | null>(null);
  const [allocDraft, setAllocDraft] = useState<Record<string, string>>({});
  const [cancelling, setCancelling] = useState<PaymentRow | null>(null);
  const set = <K extends keyof typeof emptyForm>(k: K, v: (typeof emptyForm)[K]) => setForm((f) => ({ ...f, [k]: v }));

  // cheques in the portfolio, for endorsing to a supplier instead of issuing a new one
  const { data: portfolio = [] } = useQuery({
    queryKey: ['cheques', { type: 'received', status: 'in_portfolio' }],
    queryFn: () => treasuryService.getCheques({ type: 'received', status: 'in_portfolio' }),
    enabled: showNew && form.partnerType === 'supplier' && form.method === 'cheque',
  });

  const direction = (form.partnerType === 'customer') !== form.refund ? 'inbound' : 'outbound';
  const isCheque = form.method === 'cheque';
  const endorsing = isCheque && direction === 'outbound' && form.partnerType === 'supplier' && form.chequeSource === 'endorse';
  const treasuryType = form.method === 'cash' ? 'cash' : 'bank';
  const needsTreasury = !isCheque || (direction === 'outbound' && !endorsing);
  const treasuryOptions = treasuries.filter((tr) => tr.isActive && tr.type === treasuryType);
  const selectedTreasury = treasuriesById[form.treasuryId];
  const foreign = !!selectedTreasury?.currencyId;
  const withholdingAllowed = !form.refund;
  const amountNum = Number(form.amount) || 0;
  const settled = amountNum + (withholdingAllowed ? Number(form.withholdingAmount) || 0 : 0);

  const openNew = (pt: PartnerType) => {
    setForm({ ...emptyForm, partnerType: pt, date: todayIso(), dueDate: todayIso() });
    setManual({});
    setShowNew(true);
  };

  const create = useFinAction(
    () => {
      const endorsed = portfolio.find((c) => c.id === form.endorsedChequeId);
      const payload: CreatePaymentPayload = {
        partnerType: form.partnerType,
        partnerId: form.partnerId,
        direction,
        amount: endorsed ? Number(endorsed.amount) : amountNum,
        date: form.date,
        method: form.method,
        reference: form.reference || undefined,
        treasuryId: needsTreasury && form.treasuryId ? form.treasuryId : undefined,
        currencyId: foreign ? selectedTreasury?.currencyId ?? undefined : undefined,
        exchangeRate: foreign && form.exchangeRate ? Number(form.exchangeRate) : undefined,
        withholdingAmount: withholdingAllowed && form.withholdingAmount ? Number(form.withholdingAmount) : undefined,
        endorsedChequeId: endorsing ? form.endorsedChequeId : undefined,
        cheque:
          isCheque && !endorsing
            ? {
                chequeNumber: form.chequeNumber,
                bankName: form.bankName || undefined,
                bankBranch: form.bankBranch || undefined,
                drawer: form.drawer || undefined,
                dueDate: form.dueDate,
                notes: form.chequeNotes || undefined,
              }
            : undefined,
        autoAllocate: form.allocMode === 'auto' && !form.refund ? true : undefined,
        allocations: form.allocMode === 'manual' && !form.refund ? allocationsFrom(manual) : undefined,
      };
      return treasuryService.createPayment(payload);
    },
    { invalidate: ['payments', 'treasuries', 'cash-book', 'cheques', 'open-invoices'], onSuccess: () => setShowNew(false) },
  );
  const allocate = useFinAction(
    ({ id, allocations }: { id: string; allocations: { invoiceId: string; amount: number }[] }) => treasuryService.allocatePayment(id, allocations),
    { invalidate: ['payments', 'open-invoices'], onSuccess: () => setAllocating(null) },
  );
  const cancel = useFinAction(treasuryService.cancelPayment, {
    invalidate: ['payments', 'treasuries', 'cash-book', 'cheques', 'open-invoices'],
    onSuccess: () => setCancelling(null),
  });

  const canSave =
    form.partnerId &&
    form.date &&
    (endorsing ? !!form.endorsedChequeId : amountNum > 0) &&
    (!needsTreasury || form.treasuryId) &&
    (!isCheque || endorsing || (form.chequeNumber && form.dueDate)) &&
    (!foreign || form.exchangeRate);

  const unallocated = (p: PaymentRow) => Number(p.amount) + Number(p.withholdingAmount || 0) - Number(p.allocatedAmount);

  const columns = [
    { key: 'paymentNumber', header: t('number') },
    { key: 'date', header: tc('date') },
    { key: 'partnerId', header: t('partner'), render: (p: PaymentRow) => name(partners[p.partnerId]) },
    {
      key: 'direction',
      header: t('direction'),
      render: (p: PaymentRow) => (
        <span className={p.direction === 'inbound' ? 'text-green-700' : 'text-red-700'}>{t(`dir_${p.direction}`)}</span>
      ),
    },
    { key: 'method', header: t('method'), render: (p: PaymentRow) => t(`method_${p.method}`) },
    { key: 'treasuryId', header: tt('treasury'), render: (p: PaymentRow) => (p.treasuryId ? name(treasuriesById[p.treasuryId]) : '') },
    { key: 'amount', header: tc('amount'), render: (p: PaymentRow) => <Money value={p.amount} /> },
    {
      key: 'withholdingAmount',
      header: t('withholding'),
      render: (p: PaymentRow) => (Number(p.withholdingAmount) ? <Money value={p.withholdingAmount} /> : ''),
    },
    { key: 'unallocated', header: t('unallocated'), render: (p: PaymentRow) => <Money value={unallocated(p)} /> },
    {
      key: 'exchangeRate',
      header: t('rate'),
      render: (p: PaymentRow) => (Number(p.exchangeRate) !== 1 ? <span dir="ltr">{Number(p.exchangeRate)}</span> : ''),
    },
    {
      key: 'status',
      header: tc('status'),
      render: (p: PaymentRow) => <StatusBadge status={p.status === 'bounced' ? 'rejected' : p.status} label={t(`status_${p.status}`)} />,
    },
  ];

  const partnerList = form.partnerType === 'customer' ? customers : suppliers;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
        <div className="flex gap-2">
          <Btn variant="success" onClick={() => openNew('customer')}>
            {t('newCustomerReceipt')}
          </Btn>
          <Btn variant="danger" onClick={() => openNew('supplier')}>
            {t('newSupplierPayment')}
          </Btn>
        </div>
      </div>
      <Tabs
        tabs={[
          { key: 'all', label: tc('all') },
          { key: 'customer', label: t('customerPayments') },
          { key: 'supplier', label: t('supplierPayments') },
        ]}
        value={tab}
        onChange={setTab}
      />
      <Toolbar>
        <Field label={t('partner')} className="w-56">
          <select className={inputCls} value={filters.partnerId} onChange={(e) => setFilters({ ...filters, partnerId: e.target.value })}>
            <option value="">{tc('all')}</option>
            <optgroup label={tt('customers')}>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {name(c)}
                </option>
              ))}
            </optgroup>
            <optgroup label={tt('suppliers')}>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {name(s)}
                </option>
              ))}
            </optgroup>
          </select>
        </Field>
        <Field label={tt('treasury')} className="w-56">
          <select className={inputCls} value={filters.treasuryId} onChange={(e) => setFilters({ ...filters, treasuryId: e.target.value })}>
            <option value="">{tc('all')}</option>
            {treasuries.map((tr) => (
              <option key={tr.id} value={tr.id}>
                {tr.code} - {name(tr)}
              </option>
            ))}
          </select>
        </Field>
      </Toolbar>
      <DataTable
        columns={columns}
        data={rows}
        loading={isLoading}
        searchable
        pageSize={20}
        actions={(p) =>
          p.status === 'posted' ? (
            <div className="flex gap-1">
              {unallocated(p) > 0.004 && (
                <Btn
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setAllocDraft({});
                    setAllocating(p);
                  }}
                >
                  {t('allocate')}
                </Btn>
              )}
              <Btn size="sm" variant="ghost" onClick={() => setCancelling(p)}>
                {tc('cancel')}
              </Btn>
            </div>
          ) : null
        }
      />

      {/* new payment */}
      <Modal
        isOpen={showNew}
        onClose={() => setShowNew(false)}
        title={form.partnerType === 'customer' ? t('newCustomerReceipt') : t('newSupplierPayment')}
        size="xl"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Field label={form.partnerType === 'customer' ? t('customer') : t('supplier')} className="md:col-span-2">
              <select
                className={inputCls}
                value={form.partnerId}
                onChange={(e) => {
                  set('partnerId', e.target.value);
                  setManual({});
                }}
              >
                <option value="">-</option>
                {partnerList.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} - {name(p)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={tc('date')}>
              <input type="date" className={inputCls} value={form.date} onChange={(e) => set('date', e.target.value)} />
            </Field>
            <Field label={t('method')}>
              <select
                className={inputCls}
                value={form.method}
                onChange={(e) => {
                  set('method', e.target.value as PaymentMethod);
                  set('treasuryId', '');
                }}
              >
                {(['cash', 'bank', 'card', 'cheque'] as const).map((m) => (
                  <option key={m} value={m}>
                    {t(`method_${m}`)}
                  </option>
                ))}
              </select>
            </Field>
            <label className="flex items-center gap-2 text-sm md:col-span-4">
              <input type="checkbox" checked={form.refund} onChange={(e) => set('refund', e.target.checked)} />
              {form.partnerType === 'customer' ? t('refundToCustomer') : t('refundFromSupplier')}
            </label>
          </div>

          {isCheque && form.partnerType === 'supplier' && direction === 'outbound' && (
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" checked={form.chequeSource === 'new'} onChange={() => set('chequeSource', 'new')} />
                {t('issueNewCheque')}
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={form.chequeSource === 'endorse'} onChange={() => set('chequeSource', 'endorse')} />
                {t('endorseCheque')}
              </label>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {endorsing ? (
              <Field label={t('chequeToEndorse')} className="md:col-span-2">
                <select className={inputCls} value={form.endorsedChequeId} onChange={(e) => set('endorsedChequeId', e.target.value)}>
                  <option value="">-</option>
                  {portfolio.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.chequeNumber} · {name(partners[c.partnerId])} · {Number(c.amount).toFixed(2)} · {c.dueDate}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <Field label={tc('amount') + ' *'}>
                <input type="number" step="any" className={inputCls} value={form.amount} onChange={(e) => set('amount', e.target.value)} />
              </Field>
            )}
            {needsTreasury && (
              <Field label={(form.method === 'cash' ? t('cashBox') : t('bankAccount')) + ' *'}>
                <select className={inputCls} value={form.treasuryId} onChange={(e) => set('treasuryId', e.target.value)}>
                  <option value="">-</option>
                  {treasuryOptions.map((tr) => (
                    <option key={tr.id} value={tr.id}>
                      {tr.code} - {name(tr)}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {foreign && (
              <Field label={t('exchangeRate') + ' *'} hint={t('exchangeRateHint')}>
                <input type="number" step="any" className={inputCls} value={form.exchangeRate} onChange={(e) => set('exchangeRate', e.target.value)} />
              </Field>
            )}
            {withholdingAllowed && !endorsing && (
              <Field label={t('withholding')} hint={t('withholdingHint')}>
                <input type="number" step="any" className={inputCls} value={form.withholdingAmount} onChange={(e) => set('withholdingAmount', e.target.value)} />
              </Field>
            )}
            <Field label={t('reference')}>
              <input className={inputCls} value={form.reference} onChange={(e) => set('reference', e.target.value)} />
            </Field>
          </div>

          {isCheque && !endorsing && (
            <div className="border border-gray-200 rounded-lg p-3">
              <h3 className="text-sm font-semibold mb-3">{t('chequeDetails')}</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Field label={tt('chequeNumber') + ' *'}>
                  <input className={inputCls} dir="ltr" value={form.chequeNumber} onChange={(e) => set('chequeNumber', e.target.value)} />
                </Field>
                <Field label={tt('dueDate') + ' *'}>
                  <input type="date" className={inputCls} value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
                </Field>
                {direction === 'inbound' && (
                  <>
                    <Field label={tt('bankName')}>
                      <input className={inputCls} value={form.bankName} onChange={(e) => set('bankName', e.target.value)} />
                    </Field>
                    <Field label={tt('bankBranch')}>
                      <input className={inputCls} value={form.bankBranch} onChange={(e) => set('bankBranch', e.target.value)} />
                    </Field>
                    <Field label={tt('drawer')}>
                      <input className={inputCls} value={form.drawer} onChange={(e) => set('drawer', e.target.value)} />
                    </Field>
                  </>
                )}
                <Field label={tc('notes')}>
                  <input className={inputCls} value={form.chequeNotes} onChange={(e) => set('chequeNotes', e.target.value)} />
                </Field>
              </div>
            </div>
          )}

          {!form.refund && form.partnerId && (
            <div className="border border-gray-200 rounded-lg p-3 space-y-3">
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <span className="font-semibold">{t('allocation')}</span>
                {(['auto', 'manual', 'none'] as const).map((m) => (
                  <label key={m} className="flex items-center gap-1.5">
                    <input type="radio" checked={form.allocMode === m} onChange={() => set('allocMode', m)} />
                    {t(`alloc_${m}`)}
                  </label>
                ))}
              </div>
              {form.allocMode === 'manual' && (
                <AllocationEditor
                  partnerType={form.partnerType}
                  partnerId={form.partnerId}
                  available={endorsing ? Number(portfolio.find((c) => c.id === form.endorsedChequeId)?.amount ?? 0) : settled}
                  value={manual}
                  onChange={setManual}
                />
              )}
            </div>
          )}

          <div className="flex justify-end gap-3">
            <Btn variant="secondary" onClick={() => setShowNew(false)}>
              {tc('cancel')}
            </Btn>
            <Btn disabled={!canSave || create.isPending} onClick={() => create.mutate(undefined)}>
              {create.isPending ? tc('loading') : tc('save')}
            </Btn>
          </div>
        </div>
      </Modal>

      {/* allocate existing */}
      <Modal isOpen={!!allocating} onClose={() => setAllocating(null)} title={`${t('allocate')} ${allocating?.paymentNumber ?? ''}`} size="xl">
        {allocating && (
          <div className="space-y-4">
            <AllocationEditor
              partnerType={allocating.partnerType}
              partnerId={allocating.partnerId}
              available={unallocated(allocating)}
              value={allocDraft}
              onChange={setAllocDraft}
            />
            <div className="flex justify-end gap-3">
              <Btn variant="secondary" onClick={() => setAllocating(null)}>
                {tc('cancel')}
              </Btn>
              <Btn
                disabled={allocationsFrom(allocDraft).length === 0 || allocate.isPending}
                onClick={() => allocate.mutate({ id: allocating.id, allocations: allocationsFrom(allocDraft) })}
              >
                {tc('save')}
              </Btn>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={!!cancelling}
        onClose={() => setCancelling(null)}
        onConfirm={() => cancelling && cancel.mutate(cancelling.id)}
        title={`${tc('cancel')} ${cancelling?.paymentNumber ?? ''}`}
        message={t('cancelConfirm')}
        destructive
        loading={cancel.isPending}
      />
    </div>
  );
}
