'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PrintButton } from '@/components/platform/PrintButton';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import StatusBadge from '@/components/ui/StatusBadge';
import ActionDialog, { type ActionField } from '@/components/finance/ActionDialog';
import { Btn, Field, Money, Tabs, Toolbar, fmtMoney, inputCls, todayIso, useLocalName } from '@/components/finance/ui';
import { byId, useCustomersLookup, useFinAction, useSuppliersLookup, useTreasuries, useUsersLookup } from '@/hooks/use-finance';
import { treasuryService, type Cheque, type ChequeStatus } from '@/services/finance-treasury.service';

type Action = 'deposit' | 'collect' | 'endorse' | 'return' | 'bounce' | 'clear' | 'cancel';

/** Lifecycle actions allowed per cheque type and status (mirrors the backend rules). */
function allowedActions(c: Cheque): Action[] {
  if (c.type === 'received') {
    if (c.status === 'in_portfolio') return ['deposit', 'collect', 'endorse', 'return', 'bounce', 'cancel'];
    if (c.status === 'under_collection') return ['collect', 'bounce'];
    if (c.status === 'endorsed') return ['bounce'];
    return [];
  }
  return c.status === 'issued' ? ['clear', 'bounce', 'cancel'] : [];
}

const STATUSES: ChequeStatus[] = ['in_portfolio', 'under_collection', 'collected', 'endorsed', 'returned', 'issued', 'cleared', 'bounced', 'cancelled'];
const badgeStatus: Record<ChequeStatus, string> = {
  in_portfolio: 'pending',
  under_collection: 'sent',
  collected: 'completed',
  endorsed: 'confirmed',
  returned: 'refunded',
  issued: 'pending',
  cleared: 'completed',
  bounced: 'rejected',
  cancelled: 'cancelled',
};

function monthBounds(year: number, month: number) {
  const first = new Date(Date.UTC(year, month, 1));
  const last = new Date(Date.UTC(year, month + 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10), days: last.getUTCDate(), startDow: first.getUTCDay() };
}

export default function ChequesPage() {
  const t = useTranslations('treasury');
  const tc = useTranslations('common');
  const tPl = useTranslations('platform');
  const locale = useLocale();
  const name = useLocalName();
  const { data: customers = [] } = useCustomersLookup();
  const { data: suppliers = [] } = useSuppliersLookup();
  const { data: treasuries = [] } = useTreasuries(false);
  const { data: users = [] } = useUsersLookup();
  const partners = { ...byId(customers), ...byId(suppliers) };
  const treasuriesById = byId(treasuries);
  const usersById = byId(users);
  const banks = treasuries.filter((tr) => tr.type === 'bank' && tr.isActive);

  const [tab, setTab] = useState<'list' | 'calendar'>('list');
  const [filters, setFilters] = useState({ type: '', status: '', partnerId: '', dueFrom: '', dueTo: '' });
  const { data: cheques = [], isLoading } = useQuery({ queryKey: ['cheques', filters], queryFn: () => treasuryService.getCheques(filters) });

  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const bounds = monthBounds(ym.y, ym.m);
  const { data: due } = useQuery({
    queryKey: ['cheques-due', bounds.from, bounds.to],
    queryFn: () => treasuryService.getDueCheques(bounds.from, bounds.to),
    enabled: tab === 'calendar',
  });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const [detail, setDetail] = useState<Cheque | null>(null);
  const [pending, setPending] = useState<{ action: Action; cheque: Cheque } | null>(null);

  const act = useFinAction(
    ({ id, action, data }: { id: string; action: Action; data: Record<string, unknown> }) => treasuryService.chequeAction(id, action, data),
    {
      invalidate: ['cheques', 'cheques-due', 'treasuries', 'cash-book', 'payments'],
      onSuccess: () => {
        setPending(null);
        setDetail(null);
      },
    },
  );

  const bankOptions = banks.map((b) => ({ value: b.id, label: `${b.code} - ${name(b)}` }));
  const fieldsFor = (action: Action): ActionField[] => {
    const date: ActionField = { name: 'date', label: tc('date'), type: 'date', required: true, defaultValue: todayIso() };
    const note: ActionField = { name: 'note', label: tc('notes'), type: 'text' };
    switch (action) {
      case 'deposit':
        return [{ name: 'treasuryId', label: t('depositBank'), type: 'select', required: true, options: bankOptions }, date, note];
      case 'collect':
      case 'clear':
        return [date, { name: 'treasuryId', label: t('bankOptional'), type: 'select', options: bankOptions }, note];
      case 'bounce':
        return [
          date,
          { name: 'bankCharge', label: t('bankCharge'), type: 'number' },
          ...(pending?.cheque.type === 'received'
            ? [{ name: 'chargeToCustomer', label: t('chargeToCustomer'), type: 'checkbox' } as ActionField]
            : []),
          { name: 'treasuryId', label: t('bankOptional'), type: 'select', options: bankOptions },
          note,
        ];
      case 'endorse':
        return [
          {
            name: 'supplierId',
            label: t('supplier'),
            type: 'select',
            required: true,
            options: suppliers.map((s) => ({ value: s.id, label: `${s.code} - ${name(s)}` })),
          },
          date,
          { name: 'reference', label: t('reference'), type: 'text' },
          { name: 'autoAllocate', label: t('autoAllocate'), type: 'checkbox', defaultValue: true },
        ];
      case 'return':
        return [date, note];
      case 'cancel':
        return [];
    }
  };

  const columns = [
    { key: 'chequeNumber', header: t('chequeNumber') },
    { key: 'type', header: t('chequeType'), render: (c: Cheque) => t(`cheque_${c.type}`) },
    { key: 'partnerId', header: t('partner'), render: (c: Cheque) => name(partners[c.partnerId]) },
    { key: 'bankName', header: t('bankName') },
    { key: 'issueDate', header: t('issueDate') },
    {
      key: 'dueDate',
      header: t('dueDate'),
      render: (c: Cheque) => (
        <span className={clsx(c.dueDate < todayIso() && ['in_portfolio', 'issued', 'under_collection'].includes(c.status) && 'text-red-600 font-medium')}>
          {c.dueDate}
        </span>
      ),
    },
    { key: 'amount', header: tc('amount'), render: (c: Cheque) => <Money value={c.amount} /> },
    { key: 'status', header: tc('status'), render: (c: Cheque) => <StatusBadge status={badgeStatus[c.status]} label={t(`chq_${c.status}`)} /> },
  ];

  const actionsCell = (c: Cheque) => (
    <div className="flex flex-wrap gap-1">
      {c.type === 'issued' && !['cancelled'].includes(c.status) && <PrintButton path={`/print/cheques/${c.id}`} label={tPl('print.cheque')} />}
      {allowedActions(c).map((a) => (
        <Btn key={a} size="sm" variant="ghost" onClick={() => setPending({ action: a, cheque: c })}>
          {t(`act_${a}`)}
        </Btn>
      ))}
    </div>
  );

  // ---- calendar
  const dayMap = useMemo(() => {
    const m: Record<string, { received: number; issued: number; count: number }> = {};
    for (const d of due?.days ?? []) m[d.date] = d;
    return m;
  }, [due]);
  const weekdays = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-US', { weekday: 'short', timeZone: 'UTC' });
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2024, 0, 7 + i))));
  }, [locale]);
  const monthLabel = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(ym.y, ym.m, 1)),
  );
  const shiftMonth = (delta: number) => {
    setSelectedDay(null);
    setYm(({ y, m }) => {
      const d = new Date(y, m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  };
  const dayCheques = (due?.cheques ?? []).filter((c) => !selectedDay || c.dueDate === selectedDay);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-4">{t('chequesTitle')}</h1>
      <p className="text-sm text-gray-500 mb-4">{t('chequesHint')}</p>
      <Tabs
        tabs={[
          { key: 'list', label: t('chequesList') },
          { key: 'calendar', label: t('dueCalendar') },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'list' && (
        <>
          <Toolbar>
            <Field label={t('chequeType')} className="w-40">
              <select className={inputCls} value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}>
                <option value="">{tc('all')}</option>
                <option value="received">{t('cheque_received')}</option>
                <option value="issued">{t('cheque_issued')}</option>
              </select>
            </Field>
            <Field label={tc('status')} className="w-44">
              <select className={inputCls} value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
                <option value="">{tc('all')}</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`chq_${s}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('partner')} className="w-56">
              <select className={inputCls} value={filters.partnerId} onChange={(e) => setFilters({ ...filters, partnerId: e.target.value })}>
                <option value="">{tc('all')}</option>
                <optgroup label={t('customers')}>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {name(c)}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={t('suppliers')}>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {name(s)}
                    </option>
                  ))}
                </optgroup>
              </select>
            </Field>
            <Field label={t('dueFrom')}>
              <input type="date" className={inputCls} value={filters.dueFrom} onChange={(e) => setFilters({ ...filters, dueFrom: e.target.value })} />
            </Field>
            <Field label={t('dueTo')}>
              <input type="date" className={inputCls} value={filters.dueTo} onChange={(e) => setFilters({ ...filters, dueTo: e.target.value })} />
            </Field>
          </Toolbar>
          <DataTable columns={columns} data={cheques} loading={isLoading} searchable pageSize={20} onRowClick={setDetail} actions={actionsCell} />
        </>
      )}

      {tab === 'calendar' && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2 bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <button onClick={() => shiftMonth(-1)} className="p-1.5 rounded hover:bg-gray-100" aria-label={tc('previous')}>
                {locale === 'ar' ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
              </button>
              <div className="font-semibold">{monthLabel}</div>
              <button onClick={() => shiftMonth(1)} className="p-1.5 rounded hover:bg-gray-100" aria-label={tc('next')}>
                {locale === 'ar' ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-xs">
              {weekdays.map((w) => (
                <div key={w} className="text-center text-gray-500 py-1">
                  {w}
                </div>
              ))}
              {Array.from({ length: bounds.startDow }).map((_, i) => (
                <div key={`e${i}`} />
              ))}
              {Array.from({ length: bounds.days }).map((_, i) => {
                const date = `${ym.y}-${String(ym.m + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
                const d = dayMap[date];
                return (
                  <button
                    key={date}
                    type="button"
                    onClick={() => setSelectedDay(selectedDay === date ? null : date)}
                    className={clsx(
                      'min-h-[4.5rem] rounded-lg border p-1 text-start align-top',
                      selectedDay === date ? 'border-primary-500 ring-1 ring-primary-300' : 'border-gray-100',
                      date === todayIso() && 'bg-primary-50/40',
                    )}
                  >
                    <div className="font-medium text-gray-700">{i + 1}</div>
                    {d && d.received > 0 && (
                      <div className="text-green-700 tabular-nums truncate" dir="ltr">
                        +{fmtMoney(d.received)}
                      </div>
                    )}
                    {d && d.issued > 0 && (
                      <div className="text-red-700 tabular-nums truncate" dir="ltr">
                        -{fmtMoney(d.issued)}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-6 mt-4 text-sm">
              <span>
                {t('totalReceivableCheques')}: <Money value={due?.totalReceivable ?? 0} className="text-green-700 font-semibold" />
              </span>
              <span>
                {t('totalPayableCheques')}: <Money value={due?.totalPayable ?? 0} className="text-red-700 font-semibold" />
              </span>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="font-semibold mb-3">{selectedDay ? `${t('dueOn')} ${selectedDay}` : t('dueThisMonth')}</h3>
            <div className="space-y-2 max-h-[30rem] overflow-y-auto">
              {dayCheques.length === 0 && <p className="text-sm text-gray-500">{tc('noData')}</p>}
              {dayCheques.map((c) => (
                <button key={c.id} type="button" onClick={() => setDetail(c)} className="w-full text-start p-2 rounded-lg bg-gray-50 hover:bg-gray-100">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">
                      {c.chequeNumber} · {name(partners[c.partnerId])}
                    </span>
                    <Money value={c.amount} className={c.type === 'received' ? 'text-green-700' : 'text-red-700'} />
                  </div>
                  <div className="text-xs text-gray-500">
                    {c.dueDate} · {t(`chq_${c.status}`)}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <Modal isOpen={!!detail} onClose={() => setDetail(null)} title={`${t('cheque')} ${detail?.chequeNumber ?? ''}`} size="lg">
        {detail && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-gray-500">{t('chequeType')}: </span>
                {t(`cheque_${detail.type}`)}
              </div>
              <div>
                <span className="text-gray-500">{tc('status')}: </span>
                {t(`chq_${detail.status}`)}
              </div>
              <div>
                <span className="text-gray-500">{t('partner')}: </span>
                {name(partners[detail.partnerId])}
              </div>
              <div>
                <span className="text-gray-500">{tc('amount')}: </span>
                <Money value={detail.amount} />
              </div>
              <div>
                <span className="text-gray-500">{t('bankName')}: </span>
                {detail.bankName} {detail.bankBranch}
              </div>
              <div>
                <span className="text-gray-500">{t('drawer')}: </span>
                {detail.drawer}
              </div>
              <div>
                <span className="text-gray-500">{t('issueDate')}: </span>
                {detail.issueDate}
              </div>
              <div>
                <span className="text-gray-500">{t('dueDate')}: </span>
                {detail.dueDate}
              </div>
              {detail.treasuryId && (
                <div>
                  <span className="text-gray-500">{t('bank')}: </span>
                  {name(treasuriesById[detail.treasuryId])}
                </div>
              )}
              {detail.endorsedSupplierId && (
                <div>
                  <span className="text-gray-500">{t('endorsedTo')}: </span>
                  {name(partners[detail.endorsedSupplierId])}
                </div>
              )}
            </div>
            <div>
              <h4 className="font-medium mb-2">{t('history')}</h4>
              <ol className="border-s-2 border-gray-200 ps-4 space-y-2">
                {detail.history.map((h, i) => (
                  <li key={i}>
                    <span className="font-medium">{t.has(`hist_${h.action}`) ? t(`hist_${h.action}`) : h.action}</span> · {h.date} ·{' '}
                    {usersById[h.userId]?.name ?? ''}
                    {h.note && <span className="text-gray-500"> — {h.note}</span>}
                  </li>
                ))}
              </ol>
            </div>
            <div className="flex justify-end">{actionsCell(detail)}</div>
          </div>
        )}
      </Modal>

      <ActionDialog
        open={!!pending}
        title={pending ? `${t(`act_${pending.action}`)} - ${pending.cheque.chequeNumber}` : ''}
        message={pending ? t(`actHint_${pending.action}`) : undefined}
        fields={pending ? fieldsFor(pending.action) : []}
        destructive={pending?.action === 'bounce' || pending?.action === 'cancel'}
        loading={act.isPending}
        onClose={() => setPending(null)}
        onSubmit={(v) => pending && act.mutate({ id: pending.cheque.id, action: pending.action, data: v })}
      />
    </div>
  );
}
