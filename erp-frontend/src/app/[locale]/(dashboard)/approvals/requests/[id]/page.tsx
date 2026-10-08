'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Circle, XCircle } from 'lucide-react';
import { clsx } from 'clsx';
import StatusBadge from '@/components/ui/StatusBadge';
import { Btn, Card, Field, KeyValue, Spinner, inputCls } from '@/components/finance/ui';
import { errorMessage, fmtAmount, fmtDateTime, usePlatformMutation } from '@/components/platform/ui';
import { Link } from '@/i18n/navigation';
import { useAuthStore } from '@/stores/auth.store';
import { approvalsService, platformLookups } from '@/services/platform.service';

/** One approval request: document, levels, history and the decision form. */
export default function ApprovalRequestPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations('appr');
  const tp = useTranslations('platform');
  const me = useAuthStore((s) => s.user);
  const req = useQuery({ queryKey: ['approval-requests', 'one', id], queryFn: () => approvalsService.request(id), retry: false });
  const mine = useQuery({ queryKey: ['approval-requests', 'mine'], queryFn: approvalsService.myPending });
  const { data: users = [] } = useQuery({ queryKey: ['platform-users'], queryFn: platformLookups.users, staleTime: 60_000, retry: false });
  const { data: roles = [] } = useQuery({ queryKey: ['platform-roles'], queryFn: platformLookups.roles, staleTime: 60_000, retry: false });
  const userName = (uid: string) => users.find((u) => u.id === uid)?.name ?? uid.slice(0, 8);
  const roleName = (rid?: string | null) => roles.find((r) => r.id === rid)?.name ?? '';
  const [comment, setComment] = useState('');

  const act = usePlatformMutation(
    (action: 'approve' | 'reject' | 'cancel' | 'comment') =>
      action === 'approve'
        ? approvalsService.approve(id, comment || undefined)
        : action === 'reject'
          ? approvalsService.reject(id, comment || undefined)
          : action === 'cancel'
            ? approvalsService.cancel(id, comment || undefined)
            : approvalsService.comment(id, comment),
    { invalidate: ['approval-requests'], onSuccess: () => setComment('') },
  );

  if (req.isLoading) return <Spinner />;
  if (req.isError || !req.data) return <p className="text-sm text-red-600">{errorMessage(req.error, tp('common.failed'))}</p>;
  const r = req.data;
  const canDecide = r.status === 'pending' && (mine.data ?? []).some((x) => x.id === r.id);
  const canCancel = r.status === 'pending' && r.requestedBy === me?.id;
  const levels = [...(r.levels ?? [])].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));

  return (
    <div className="space-y-4">
      <div>
        <Link href="/approvals/requests" className="text-sm text-primary-600 hover:underline">
          {t('requestsTitle')}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">
            {t('request')} {r.requestNumber}
          </h1>
          <StatusBadge status={r.status} label={t(`status.${r.status}`)} />
        </div>
      </div>
      <Card>
        <KeyValue
          items={[
            { label: t('documentType'), value: t(`doc.${r.documentType}`) },
            { label: t('document'), value: r.documentRef || '-' },
            { label: tp('common.amount'), value: <span dir="ltr">{fmtAmount(r.amount)}</span> },
            { label: t('requestedBy'), value: userName(r.requestedBy) },
            { label: tp('common.date'), value: fmtDateTime(r.createdAt) },
            { label: t('decidedAt'), value: r.decidedAt ? fmtDateTime(r.decidedAt) : '-' },
            { label: t('executedAt'), value: r.executedAt ? fmtDateTime(r.executedAt) : '-' },
            { label: tp('common.description'), value: r.description || '-' },
          ]}
        />
        {r.status === 'approved' && !r.executedAt && r.documentType !== 'other' && <p className="text-xs text-amber-700 mt-3">{t('approvedRetryHint')}</p>}
      </Card>

      <Card title={t('levels')}>
        <ol className="space-y-2">
          {levels.map((l) => {
            const seq = l.sequence ?? 0;
            const done = r.status === 'approved' || seq < r.currentLevel;
            const rejected = r.status === 'rejected' && seq === r.currentLevel;
            const approvals = (r.actions ?? []).filter((a) => a.level === seq && a.action === 'approve');
            return (
              <li key={seq} className={clsx('flex items-start gap-3 rounded-lg px-3 py-2', seq === r.currentLevel && r.status === 'pending' ? 'bg-amber-50' : 'bg-gray-50')}>
                {rejected ? (
                  <XCircle className="text-red-600 mt-0.5" size={18} />
                ) : done ? (
                  <CheckCircle2 className="text-green-600 mt-0.5" size={18} />
                ) : (
                  <Circle className="text-gray-400 mt-0.5" size={18} />
                )}
                <div className="text-sm">
                  <p className="font-medium">
                    {t('levelN', { n: seq })}
                    {l.name ? ` – ${l.name}` : ''}
                  </p>
                  <p className="text-gray-600">
                    {[roleName(l.roleId), ...(l.userIds ?? []).map(userName)].filter(Boolean).join('، ')} · {t('needs', { n: l.minApprovers ?? 1 })}
                  </p>
                  {approvals.length > 0 && <p className="text-green-700">{t('approvedBy', { names: approvals.map((a) => userName(a.userId)).join('، ') })}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      </Card>

      <Card title={t('history')}>
        <ul className="space-y-2 text-sm">
          {(r.actions ?? []).map((a) => (
            <li key={a.id} className="border-b border-gray-100 pb-2">
              <span className="font-medium">{userName(a.userId)}</span> · {t(`action.${a.action}`)}
              {a.level ? ` (${t('levelN', { n: a.level })})` : ''} · <span className="text-gray-500">{fmtDateTime(a.createdAt)}</span>
              {a.comment && <p className="text-gray-700 mt-0.5 whitespace-pre-line">“{a.comment}”</p>}
            </li>
          ))}
        </ul>
      </Card>

      {r.status === 'pending' && (
        <Card title={canDecide ? t('yourDecision') : t('addComment')}>
          <Field label={tp('common.comment')}>
            <textarea className={inputCls} rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
          <div className="flex flex-wrap justify-end gap-2 mt-3">
            <Btn variant="secondary" disabled={!comment.trim() || act.isPending} onClick={() => act.mutate('comment')}>
              {t('commentOnly')}
            </Btn>
            {canCancel && (
              <Btn variant="secondary" disabled={act.isPending} onClick={() => act.mutate('cancel')}>
                {t('withdraw')}
              </Btn>
            )}
            {canDecide && (
              <>
                <Btn variant="danger" disabled={act.isPending} onClick={() => act.mutate('reject')}>
                  {t('reject')}
                </Btn>
                <Btn variant="success" disabled={act.isPending} onClick={() => act.mutate('approve')}>
                  {t('approve')}
                </Btn>
              </>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
