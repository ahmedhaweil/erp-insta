'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import StatusBadge from '@/components/ui/StatusBadge';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import AccountPicker, { useAccountLabel } from '@/components/finance/AccountPicker';
import { Btn, Field, Money, Tabs, fmtMoney, inputCls, todayIso } from '@/components/finance/ui';
import { useFinAction } from '@/hooks/use-finance';
import { finAccountingService, type JournalEntryRow } from '@/services/finance-accounting.service';

type LineDraft = { accountId: string; debit: string; credit: string; description: string; amountCurrency: string };
const emptyLine = (): LineDraft => ({ accountId: '', debit: '', credit: '', description: '', amountCurrency: '' });

const total = (e: JournalEntryRow) => e.lines?.reduce((s, l) => s + Number(l.debit), 0) ?? 0;

/** Groups the journals seen on existing entries by what posts into them (there is no journals endpoint). */
function journalKind(sourceTypes: Set<string>): string {
  const has = (p: string) => [...sourceTypes].some((s) => s.startsWith(p));
  if (has('sales') || has('pos')) return 'sale';
  if (has('purchase')) return 'purchase';
  if (has('payment') || has('treasury_voucher') || has('treasury_transfer') || has('cheque')) return 'treasury';
  return 'general';
}

export default function JournalEntriesPage() {
  const t = useTranslations('acct');
  const tc = useTranslations('common');
  const accountLabel = useAccountLabel();
  const { data: entries = [], isLoading } = useQuery({ queryKey: ['fin-journal-entries'], queryFn: finAccountingService.getJournalEntries });

  const [status, setStatus] = useState<'all' | 'draft' | 'posted' | 'cancelled'>('all');
  const [origin, setOrigin] = useState<'all' | 'manual' | 'auto'>('all');
  const [detail, setDetail] = useState<JournalEntryRow | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'post' | 'reverse' | 'cancel'; entry: JournalEntryRow } | null>(null);
  const [showNew, setShowNew] = useState(false);

  // ---- create form
  const journals = useMemo(() => {
    const map = new Map<string, { types: Set<string>; count: number }>();
    for (const e of entries) {
      const j = map.get(e.journalId) ?? { types: new Set<string>(), count: 0 };
      j.types.add(e.sourceType ?? 'manual');
      j.count += 1;
      map.set(e.journalId, j);
    }
    return [...map.entries()].map(([id, v]) => ({ id, kind: journalKind(v.types), count: v.count }));
  }, [entries]);
  const defaultJournal = journals.find((j) => j.kind === 'general')?.id ?? journals[0]?.id ?? '';

  const [form, setForm] = useState({ journalId: '', date: todayIso(), description: '', exchangeRate: '' });
  const [lines, setLines] = useState<LineDraft[]>([emptyLine(), emptyLine()]);
  const sumDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const sumCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const diff = Math.round((sumDebit - sumCredit) * 100) / 100;
  const linesValid = lines.every((l) => l.accountId && (Number(l.debit) > 0) !== (Number(l.credit) > 0));
  const canSave = (form.journalId || defaultJournal) && form.date && lines.length >= 2 && linesValid && diff === 0 && sumDebit > 0;

  const openNew = () => {
    setForm({ journalId: defaultJournal, date: todayIso(), description: '', exchangeRate: '' });
    setLines([emptyLine(), emptyLine()]);
    setShowNew(true);
  };

  const setLine = (i: number, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const create = useFinAction(
    (post: boolean) =>
      finAccountingService
        .createJournalEntry({
          journalId: form.journalId || defaultJournal,
          date: form.date,
          description: form.description || undefined,
          exchangeRate: form.exchangeRate ? Number(form.exchangeRate) : undefined,
          lines: lines.map((l) => ({
            accountId: l.accountId,
            debit: Number(l.debit) || 0,
            credit: Number(l.credit) || 0,
            description: l.description || undefined,
            amountCurrency: l.amountCurrency ? Number(l.amountCurrency) : undefined,
          })),
        })
        .then((e) => (post ? finAccountingService.postJournalEntry(e.id) : e)),
    { invalidate: ['fin-journal-entries', 'journal-entries'], onSuccess: () => setShowNew(false) },
  );

  const act = useFinAction(
    ({ kind, id }: { kind: 'post' | 'reverse' | 'cancel'; id: string }) =>
      kind === 'post'
        ? finAccountingService.postJournalEntry(id)
        : kind === 'reverse'
          ? finAccountingService.reverseJournalEntry(id)
          : finAccountingService.cancelJournalEntry(id),
    {
      invalidate: ['fin-journal-entries', 'journal-entries'],
      onSuccess: () => {
        setConfirm(null);
        setDetail(null);
      },
    },
  );

  const reversedIds = new Set(entries.filter((e) => e.reversedEntryId && e.status === 'posted').map((e) => e.reversedEntryId));

  const filtered = entries.filter(
    (e) =>
      (status === 'all' || e.status === status) &&
      (origin === 'all' || (origin === 'manual' ? !e.sourceType : !!e.sourceType)),
  );

  const isForeign = (e: JournalEntryRow) => Number(e.exchangeRate) !== 1 || e.lines?.some((l) => l.amountCurrency != null);

  const columns = [
    { key: 'refNumber', header: t('refNumber') },
    { key: 'date', header: tc('date') },
    { key: 'description', header: tc('description') },
    {
      key: 'sourceType',
      header: t('source'),
      render: (e: JournalEntryRow) => (e.sourceType ? (t.has(`src.${e.sourceType}`) ? t(`src.${e.sourceType}`) : e.sourceType) : t('manual')),
    },
    { key: 'total', header: t('amount'), render: (e: JournalEntryRow) => <Money value={total(e)} /> },
    {
      key: 'exchangeRate',
      header: t('currency'),
      render: (e: JournalEntryRow) => (isForeign(e) ? <span className="text-xs text-amber-700" dir="ltr">FX × {Number(e.exchangeRate)}</span> : ''),
    },
    {
      key: 'status',
      header: tc('status'),
      render: (e: JournalEntryRow) => <StatusBadge status={e.status} label={tc(e.status)} />,
    },
  ];

  const actionButtons = (e: JournalEntryRow) => (
    <div className="flex gap-1">
      {e.status === 'draft' && (
        <>
          <Btn size="sm" variant="ghost" onClick={() => setConfirm({ kind: 'post', entry: e })}>
            {t('postEntry')}
          </Btn>
          <Btn size="sm" variant="ghost" onClick={() => setConfirm({ kind: 'cancel', entry: e })}>
            {tc('cancel')}
          </Btn>
        </>
      )}
      {e.status === 'posted' && !e.sourceType && !reversedIds.has(e.id) && !e.reversedEntryId && (
        <Btn size="sm" variant="ghost" onClick={() => setConfirm({ kind: 'reverse', entry: e })}>
          {t('reverseEntry')}
        </Btn>
      )}
    </div>
  );

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold text-gray-900">{t('journalEntriesTitle')}</h1>
        <Btn onClick={openNew}>{t('newJournalEntry')}</Btn>
      </div>
      <Tabs
        tabs={(['all', 'draft', 'posted', 'cancelled'] as const).map((s) => ({ key: s, label: s === 'all' ? tc('all') : tc(s) }))}
        value={status}
        onChange={setStatus}
      />
      <div className="flex gap-2 mb-4">
        {(['all', 'manual', 'auto'] as const).map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => setOrigin(o)}
            className={clsx('px-3 py-1 rounded-full text-xs border', origin === o ? 'bg-primary-600 text-white border-primary-600' : 'bg-white border-gray-300')}
          >
            {t(`origin_${o}`)}
          </button>
        ))}
      </div>
      <DataTable columns={columns} data={filtered} loading={isLoading} searchable pageSize={20} onRowClick={setDetail} actions={actionButtons} />

      {/* detail */}
      <Modal isOpen={!!detail} onClose={() => setDetail(null)} title={`${t('entry')} ${detail?.refNumber ?? ''}`} size="xl">
        {detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div>
                <span className="text-gray-500">{tc('date')}: </span>
                {detail.date}
              </div>
              <div>
                <span className="text-gray-500">{tc('status')}: </span>
                {tc(detail.status)}
              </div>
              <div>
                <span className="text-gray-500">{t('source')}: </span>
                {detail.sourceType ? (t.has(`src.${detail.sourceType}`) ? t(`src.${detail.sourceType}`) : detail.sourceType) : t('manual')}
              </div>
              {isForeign(detail) && (
                <div>
                  <span className="text-gray-500">{t('exchangeRate')}: </span>
                  <span dir="ltr">{Number(detail.exchangeRate)}</span>
                </div>
              )}
            </div>
            {detail.description && <p className="text-sm">{detail.description}</p>}
            <table className="w-full text-sm border border-gray-200 rounded-lg">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-start px-3 py-2">{t('account')}</th>
                  <th className="text-start px-3 py-2">{tc('description')}</th>
                  <th className="text-end px-3 py-2">{t('debit')}</th>
                  <th className="text-end px-3 py-2">{t('credit')}</th>
                  {isForeign(detail) && <th className="text-end px-3 py-2">{t('amountCurrency')}</th>}
                </tr>
              </thead>
              <tbody>
                {detail.lines.map((l, i) => (
                  <tr key={l.id ?? i} className="border-t border-gray-100">
                    <td className="px-3 py-1.5">{accountLabel(l.accountId)}</td>
                    <td className="px-3 py-1.5">{l.description}</td>
                    <td className="px-3 py-1.5 text-end">{Number(l.debit) ? <Money value={l.debit} /> : ''}</td>
                    <td className="px-3 py-1.5 text-end">{Number(l.credit) ? <Money value={l.credit} /> : ''}</td>
                    {isForeign(detail) && (
                      <td className="px-3 py-1.5 text-end">{l.amountCurrency != null ? <Money value={l.amountCurrency} /> : ''}</td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-100 font-semibold">
                <tr>
                  <td className="px-3 py-2" colSpan={2}>
                    {tc('total')}
                  </td>
                  <td className="px-3 py-2 text-end">
                    <Money value={detail.lines.reduce((s, l) => s + Number(l.debit), 0)} />
                  </td>
                  <td className="px-3 py-2 text-end">
                    <Money value={detail.lines.reduce((s, l) => s + Number(l.credit), 0)} />
                  </td>
                  {isForeign(detail) && <td />}
                </tr>
              </tfoot>
            </table>
            <div className="flex justify-end">{actionButtons(detail)}</div>
          </div>
        )}
      </Modal>

      {/* create */}
      <Modal isOpen={showNew} onClose={() => setShowNew(false)} title={t('newJournalEntry')} size="xl">
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Field label={t('journal')} hint={journals.length ? undefined : t('journalIdHint')}>
              {journals.length ? (
                <select className={inputCls} value={form.journalId} onChange={(e) => setForm({ ...form, journalId: e.target.value })}>
                  {journals.map((j) => (
                    <option key={j.id} value={j.id}>
                      {t(`journalKind_${j.kind}`)} ({j.count})
                    </option>
                  ))}
                </select>
              ) : (
                <input className={inputCls} dir="ltr" value={form.journalId} onChange={(e) => setForm({ ...form, journalId: e.target.value.trim() })} />
              )}
            </Field>
            <Field label={tc('date')}>
              <input type="date" className={inputCls} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </Field>
            <Field label={t('exchangeRate')} hint={t('exchangeRateHint')}>
              <input type="number" step="any" className={inputCls} value={form.exchangeRate} onChange={(e) => setForm({ ...form, exchangeRate: e.target.value })} />
            </Field>
            <Field label={tc('description')}>
              <input className={inputCls} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-start px-2 py-2 w-[34%]">{t('account')}</th>
                  <th className="text-start px-2 py-2">{tc('description')}</th>
                  <th className="text-start px-2 py-2 w-32">{t('debit')}</th>
                  <th className="text-start px-2 py-2 w-32">{t('credit')}</th>
                  {form.exchangeRate && <th className="text-start px-2 py-2 w-32">{t('amountCurrency')}</th>}
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="px-2 py-1.5">
                      <AccountPicker value={l.accountId} onChange={(id) => setLine(i, { accountId: id })} />
                    </td>
                    <td className="px-2 py-1.5">
                      <input className={inputCls} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        step="any"
                        min="0"
                        className={inputCls}
                        value={l.debit}
                        onChange={(e) => setLine(i, { debit: e.target.value, credit: e.target.value ? '' : l.credit })}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        step="any"
                        min="0"
                        className={inputCls}
                        value={l.credit}
                        onChange={(e) => setLine(i, { credit: e.target.value, debit: e.target.value ? '' : l.debit })}
                      />
                    </td>
                    {form.exchangeRate && (
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          step="any"
                          className={inputCls}
                          value={l.amountCurrency}
                          onChange={(e) => setLine(i, { amountCurrency: e.target.value })}
                        />
                      </td>
                    )}
                    <td className="px-2 py-1.5">
                      <button
                        type="button"
                        disabled={lines.length <= 2}
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
                  <td className="px-2 py-2 tabular-nums" dir="ltr">{fmtMoney(sumDebit)}</td>
                  <td className="px-2 py-2 tabular-nums" dir="ltr">{fmtMoney(sumCredit)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
          <div className={clsx('text-sm rounded-lg px-3 py-2', diff === 0 && sumDebit > 0 ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-800')}>
            {diff === 0 && sumDebit > 0 ? t('balanced') : t('unbalancedBy', { amount: fmtMoney(Math.abs(diff)) })}
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

      <ConfirmDialog
        isOpen={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && act.mutate({ kind: confirm.kind, id: confirm.entry.id })}
        title={confirm ? t(`confirm_${confirm.kind}_title`) : ''}
        message={confirm ? t(`confirm_${confirm.kind}`, { ref: confirm.entry.refNumber }) : ''}
        destructive={confirm?.kind !== 'post'}
        loading={act.isPending}
      />
    </div>
  );
}
