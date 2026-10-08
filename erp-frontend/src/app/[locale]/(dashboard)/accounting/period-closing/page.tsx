'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, AlertTriangle, Lock, Unlock } from 'lucide-react';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { Btn, Card, Field, Spinner, fmtDateTime, inputCls } from '@/components/finance/ui';
import { byId, useFinAction, useUsersLookup } from '@/hooks/use-finance';
import { depthService, type PeriodClosingLog } from '@/services/finance-depth.service';

function lastMonth() {
  const d = new Date();
  d.setDate(0);
  return d.toISOString().slice(0, 7);
}

function periodEnd(period: string) {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Month-end closing: checklist of open items, lock the books, reopen, history. */
export default function PeriodClosingPage() {
  const t = useTranslations('depth');
  const tc = useTranslations('common');
  const { data: users = [] } = useUsersLookup();
  const usersById = byId(users);
  const [period, setPeriod] = useState(lastMonth());
  const end = /^\d{4}-\d{2}$/.test(period) ? periodEnd(period) : '';
  const checklist = useQuery({ queryKey: ['period-closing', 'checklist', end], queryFn: () => depthService.checklist(end), enabled: !!end });
  const { data: history = [], isLoading } = useQuery({ queryKey: ['period-closing', 'history'], queryFn: depthService.closingHistory });
  const [notes, setNotes] = useState('');
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenForm, setReopenForm] = useState({ date: '', notes: '' });

  const lock = useFinAction(() => depthService.lock({ period, notes: notes || undefined }), {
    invalidate: ['period-closing', 'accounting-settings'],
    success: t('periodLocked'),
    onSuccess: () => setNotes(''),
  });
  const reopen = useFinAction(() => depthService.reopen({ date: reopenForm.date || undefined, notes: reopenForm.notes || undefined }), {
    invalidate: ['period-closing', 'accounting-settings'],
    success: t('periodReopened'),
    onSuccess: () => setReopenOpen(false),
  });

  const data = checklist.data;
  const lockedAlready = !!data?.currentLockDate && !!end && end <= data.currentLockDate;

  const columns = [
    { key: 'createdAt', header: tc('date'), render: (r: PeriodClosingLog) => fmtDateTime(r.createdAt) },
    { key: 'action', header: t('action'), render: (r: PeriodClosingLog) => t(`closing_${r.action}`) },
    { key: 'lockDate', header: t('lockDate'), render: (r: PeriodClosingLog) => r.lockDate ?? t('noLock') },
    { key: 'previousLockDate', header: t('previousLockDate'), render: (r: PeriodClosingLog) => r.previousLockDate ?? '-' },
    { key: 'warnings', header: t('warnings'), render: (r: PeriodClosingLog) => (r.warnings ?? []).reduce((s, w) => s + w.count, 0) || '-' },
    { key: 'userId', header: t('user'), render: (r: PeriodClosingLog) => usersById[r.userId]?.name ?? '' },
    { key: 'notes', header: tc('notes') },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('closingTitle')}</h1>
          <p className="text-sm text-gray-500">{t('closingIntro')}</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="inline-flex items-center gap-1 bg-gray-100 rounded-lg px-3 py-2">
            <Lock size={14} /> {t('currentLock')}: <b dir="ltr">{data?.currentLockDate ?? t('noLock')}</b>
          </span>
          {data?.currentLockDate && (
            <Btn
              variant="secondary"
              onClick={() => {
                setReopenForm({ date: '', notes: '' });
                setReopenOpen(true);
              }}
            >
              <Unlock size={14} /> {t('reopen')}
            </Btn>
          )}
        </div>
      </div>

      <Card title={t('checklist')}>
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <Field label={t('period')}>
            <input type="month" className={inputCls} value={period} onChange={(e) => setPeriod(e.target.value)} />
          </Field>
          {end && <span className="text-sm text-gray-500 pb-2">{t('periodEnd', { date: end })}</span>}
        </div>
        {checklist.isLoading ? (
          <Spinner />
        ) : data ? (
          <div className="space-y-2">
            {data.checks.map((c) => (
              <div
                key={c.code}
                className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${c.count ? 'bg-amber-50 text-amber-900' : 'bg-green-50 text-green-800'}`}
              >
                <span className="inline-flex items-center gap-2">
                  {c.count ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
                  {t.has(`check_${c.code}`) ? t(`check_${c.code}`) : c.message}
                </span>
                <b>{c.count}</b>
              </div>
            ))}
            <p className={`text-sm font-medium ${data.ready ? 'text-green-700' : 'text-amber-700'}`}>{data.ready ? t('readyToLock') : t('lockWithWarnings')}</p>
            <div className="flex flex-wrap items-end gap-3 pt-2">
              <Field label={tc('notes')} className="flex-1 min-w-60">
                <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
              <Btn disabled={lockedAlready || lock.isPending} onClick={() => lock.mutate(undefined)}>
                <Lock size={14} /> {lockedAlready ? t('alreadyLocked') : t('lockPeriod', { period })}
              </Btn>
            </div>
          </div>
        ) : null}
      </Card>

      <Card title={t('closingHistory')}>
        <DataTable columns={columns} data={history} loading={isLoading} pageSize={15} />
      </Card>

      <Modal isOpen={reopenOpen} onClose={() => setReopenOpen(false)} title={t('reopen')} size="sm">
        <div className="space-y-4">
          <Field label={t('newLockDate')} hint={t('newLockDateHint')}>
            <input type="date" className={inputCls} value={reopenForm.date} onChange={(e) => setReopenForm({ ...reopenForm, date: e.target.value })} />
          </Field>
          <Field label={tc('notes')}>
            <input className={inputCls} value={reopenForm.notes} onChange={(e) => setReopenForm({ ...reopenForm, notes: e.target.value })} />
          </Field>
          <div className="flex justify-end gap-3">
            <Btn variant="secondary" onClick={() => setReopenOpen(false)}>
              {tc('cancel')}
            </Btn>
            <Btn variant="danger" disabled={reopen.isPending} onClick={() => reopen.mutate(undefined)}>
              {t('reopen')}
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}
