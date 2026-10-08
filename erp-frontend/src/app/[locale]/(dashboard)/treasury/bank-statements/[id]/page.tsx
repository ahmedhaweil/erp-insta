'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, CheckCircle2, AlertTriangle } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import ActionDialog from '@/components/finance/ActionDialog';
import { ReportTable } from '@/components/finance/ReportTable';
import { Btn, Card, KeyValue, Money, Spinner, Tabs, fmtMoney } from '@/components/finance/ui';
import { useRouter } from '@/i18n/navigation';
import { useFinAction } from '@/hooks/use-finance';
import { treasuryService, type StatementLine } from '@/services/finance-treasury.service';

export default function BankStatementPage() {
  const t = useTranslations('treasury');
  const tc = useTranslations('common');
  const ta = useTranslations('acct');
  const locale = useLocale();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<'lines' | 'report'>('lines');

  const { data: statement, isLoading } = useQuery({ queryKey: ['bank-statement', id], queryFn: () => treasuryService.getStatement(id) });
  const { data: report } = useQuery({ queryKey: ['bank-statement-report', id], queryFn: () => treasuryService.getReconciliation(id) });

  const [showAuto, setShowAuto] = useState(false);
  const [matching, setMatching] = useState<StatementLine | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [voucherFor, setVoucherFor] = useState<StatementLine | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: book } = useQuery({
    queryKey: ['cash-book', statement?.treasuryId, 'unreconciled'],
    queryFn: () => treasuryService.getMovements(statement!.treasuryId),
    enabled: !!matching && !!statement,
  });
  const unreconciled = (book?.movements ?? []).filter((m) => !m.reconciled);

  const inv = ['bank-statement', 'bank-statement-report', 'bank-statements', 'cash-book'];
  const autoMatch = useFinAction((days?: number) => treasuryService.autoMatch(id, days), {
    invalidate: inv,
    onSuccess: (r) => setShowAuto(false),
  });
  const match = useFinAction(({ lineId, ids }: { lineId: string; ids: string[] }) => treasuryService.matchLine(lineId, ids), {
    invalidate: inv,
    onSuccess: () => setMatching(null),
  });
  const unmatch = useFinAction(treasuryService.unmatchLine, { invalidate: inv });
  const voucher = useFinAction(
    ({ lineId, data }: { lineId: string; data: { accountId?: string; description?: string } }) => treasuryService.lineVoucher(lineId, data),
    { invalidate: [...inv, 'vouchers', 'treasuries'], onSuccess: () => setVoucherFor(null) },
  );
  const closeSt = useFinAction(() => treasuryService.closeStatement(id), { invalidate: inv });
  const reopen = useFinAction(() => treasuryService.reopenStatement(id), { invalidate: inv });
  const remove = useFinAction(() => treasuryService.deleteStatement(id), {
    invalidate: ['bank-statements'],
    onSuccess: () => router.push('/treasury/bank-statements'),
  });

  if (isLoading || !statement) return <Spinner />;
  const Back = locale === 'ar' ? ArrowRight : ArrowLeft;
  const open = statement.status === 'open';
  const lines = statement.lines ?? [];
  const selectedSum = unreconciled.filter((m) => selected.includes(m.journalLineId)).reduce((s, m) => s + m.amount, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/treasury/bank-statements')} className="p-2 rounded-lg hover:bg-gray-100" aria-label={tc('back')}>
            <Back size={18} />
          </button>
          <h1 className="text-2xl font-bold text-gray-900">
            {t('statement')} {statement.reference ?? ''} ({statement.startDate} → {statement.endDate})
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {open && (
            <>
              <Btn onClick={() => setShowAuto(true)}>{t('autoMatch')}</Btn>
              <Btn variant="success" onClick={() => closeSt.mutate(undefined)} disabled={closeSt.isPending}>
                {t('markReconciled')}
              </Btn>
              <Btn variant="secondary" onClick={() => setConfirmDelete(true)}>
                {tc('delete')}
              </Btn>
            </>
          )}
          {!open && (
            <Btn variant="secondary" onClick={() => reopen.mutate(undefined)} disabled={reopen.isPending}>
              {t('reopen')}
            </Btn>
          )}
        </div>
      </div>

      <Card>
        <KeyValue
          items={[
            { label: t('openingBalance'), value: <Money value={statement.openingBalance} /> },
            { label: t('closingBalance'), value: <Money value={statement.closingBalance} /> },
            { label: t('matchedLines'), value: `${lines.filter((l) => l.isMatched).length} / ${lines.length}` },
            { label: tc('status'), value: t(`stmt_${statement.status}`) },
          ]}
        />
      </Card>

      <Tabs
        tabs={[
          { key: 'lines', label: t('statementLines') },
          { key: 'report', label: t('reconciliationReport') },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'lines' && (
        <ReportTable
          section={{
            columns: [
              { key: 'date', label: tc('date'), type: 'date' },
              { key: 'description', label: tc('description') },
              { key: 'reference', label: t('reference') },
              { key: 'deposit', label: t('deposit'), type: 'money' },
              { key: 'withdrawal', label: t('withdrawal'), type: 'money' },
              {
                key: 'isMatched',
                label: t('matched'),
                render: (l) =>
                  l.isMatched ? (
                    <span className="text-green-700 inline-flex items-center gap-1">
                      <CheckCircle2 size={14} /> {t('matched')}
                    </span>
                  ) : (
                    <span className="text-amber-700">{t('unmatched')}</span>
                  ),
              },
              {
                key: 'actions',
                label: tc('actions'),
                render: (l: StatementLine) =>
                  !open ? null : l.isMatched ? (
                    <Btn size="sm" variant="ghost" onClick={() => unmatch.mutate(l.id)} disabled={unmatch.isPending}>
                      {t('unmatch')}
                    </Btn>
                  ) : (
                    <div className="flex gap-1">
                      <Btn
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setSelected([]);
                          setMatching(l);
                        }}
                      >
                        {t('matchManually')}
                      </Btn>
                      <Btn size="sm" variant="ghost" onClick={() => setVoucherFor(l)}>
                        {t('createVoucher')}
                      </Btn>
                    </div>
                  ),
              },
            ],
            rows: lines.map((l) => ({
              ...l,
              deposit: Number(l.amount) > 0 ? Number(l.amount) : null,
              withdrawal: Number(l.amount) < 0 ? -Number(l.amount) : null,
            })),
            rowClass: (l) => (l.isMatched ? 'bg-green-50/40' : undefined),
          }}
        />
      )}

      {tab === 'report' && report && (
        <div className="space-y-4">
          <div
            className={`rounded-xl p-4 flex items-center gap-3 ${report.difference === 0 ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`}
          >
            {report.difference === 0 ? <CheckCircle2 /> : <AlertTriangle />}
            <span>{report.difference === 0 ? t('reconciledOk') : t('reconcileDifference', { amount: fmtMoney(report.difference) })}</span>
          </div>
          <Card>
            <table className="w-full text-sm">
              <tbody>
                {[
                  ['statementBalance', report.statementBalance],
                  ['depositsInTransit', report.totalDepositsInTransit],
                  ['outstandingPayments', -report.totalOutstandingPayments],
                  ['adjustedBankBalance', report.adjustedBankBalance],
                  ['bookBalance', report.bookBalance],
                  ['unmatchedStatementLines', report.totalUnmatchedStatementLines],
                  ['adjustedBookBalance', report.adjustedBookBalance],
                  ['difference', report.difference],
                ].map(([k, v]) => (
                  <tr key={k as string} className="border-b border-gray-100 last:border-0">
                    <td className={`py-2 ${['adjustedBankBalance', 'adjustedBookBalance', 'difference'].includes(k as string) ? 'font-semibold' : 'ps-4'}`}>
                      {t(`rec_${k}`)}
                    </td>
                    <td className="py-2 text-end">
                      <Money value={v} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          {[
            { title: t('rec_depositsInTransit'), rows: report.depositsInTransit },
            { title: t('rec_outstandingPayments'), rows: report.outstandingPayments },
          ].map((s) => (
            <ReportTable
              key={s.title}
              section={{
                title: s.title,
                columns: [
                  { key: 'date', label: tc('date'), type: 'date' },
                  { key: 'refNumber', label: ta('refNumber') },
                  { key: 'description', label: tc('description') },
                  { key: 'amount', label: tc('amount'), type: 'money' },
                ],
                rows: s.rows.map((r: any, i: number) => ({ id: r.journalLineId ?? i, ...r })),
              }}
            />
          ))}
          <ReportTable
            section={{
              title: t('rec_unmatchedStatementLines'),
              columns: [
                { key: 'date', label: tc('date'), type: 'date' },
                { key: 'description', label: tc('description') },
                { key: 'reference', label: t('reference') },
                { key: 'amount', label: tc('amount'), type: 'money' },
              ],
              rows: report.unmatchedStatementLines,
            }}
          />
        </div>
      )}

      <ActionDialog
        open={showAuto}
        title={t('autoMatch')}
        message={t('autoMatchHint')}
        fields={[{ name: 'dayTolerance', label: t('dayTolerance'), type: 'number', defaultValue: 7 }]}
        loading={autoMatch.isPending}
        onClose={() => setShowAuto(false)}
        onSubmit={(v) => autoMatch.mutate(v.dayTolerance)}
      />

      <ActionDialog
        open={!!voucherFor}
        title={t('createVoucher')}
        message={voucherFor ? `${voucherFor.date} · ${voucherFor.description ?? ''} · ${fmtMoney(voucherFor.amount)}` : undefined}
        fields={[
          { name: 'accountId', label: t('counterAccount'), type: 'account' },
          { name: 'description', label: tc('description'), type: 'text', defaultValue: voucherFor?.description ?? '' },
        ]}
        loading={voucher.isPending}
        onClose={() => setVoucherFor(null)}
        onSubmit={(v) => voucherFor && voucher.mutate({ lineId: voucherFor.id, data: v })}
      />

      <Modal isOpen={!!matching} onClose={() => setMatching(null)} title={t('matchManually')} size="xl">
        {matching && (
          <div className="space-y-3">
            <p className="text-sm">
              {t('statementLine')}: {matching.date} · {matching.description} · <Money value={matching.amount} />
            </p>
            <p className="text-sm">
              {t('selectedTotal')}: <Money value={selectedSum} />{' '}
              {Math.abs(selectedSum - Number(matching.amount)) < 0.005 ? (
                <span className="text-green-700">✓</span>
              ) : (
                <span className="text-amber-700">({t('mustEqualLine')})</span>
              )}
            </p>
            <div className="max-h-96 overflow-y-auto border border-gray-200 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="w-8" />
                    <th className="text-start px-2 py-1.5">{tc('date')}</th>
                    <th className="text-start px-2 py-1.5">{ta('refNumber')}</th>
                    <th className="text-start px-2 py-1.5">{tc('description')}</th>
                    <th className="text-end px-2 py-1.5">{tc('amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {unreconciled.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-4 text-center text-gray-500">
                        {tc('noData')}
                      </td>
                    </tr>
                  )}
                  {unreconciled.map((m) => (
                    <tr key={m.journalLineId} className="border-t border-gray-100">
                      <td className="px-2">
                        <input
                          type="checkbox"
                          checked={selected.includes(m.journalLineId)}
                          onChange={(e) =>
                            setSelected((s) => (e.target.checked ? [...s, m.journalLineId] : s.filter((x) => x !== m.journalLineId)))
                          }
                        />
                      </td>
                      <td className="px-2 py-1">{m.date}</td>
                      <td className="px-2 py-1">{m.refNumber}</td>
                      <td className="px-2 py-1">{m.description}</td>
                      <td className="px-2 py-1 text-end">
                        <Money value={m.amount} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-3">
              <Btn variant="secondary" onClick={() => setMatching(null)}>
                {tc('cancel')}
              </Btn>
              <Btn disabled={!selected.length || match.isPending} onClick={() => match.mutate({ lineId: matching.id, ids: selected })}>
                {t('match')}
              </Btn>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate(undefined)}
        title={tc('delete')}
        message={tc('confirmDelete')}
        destructive
        loading={remove.isPending}
      />
    </div>
  );
}
