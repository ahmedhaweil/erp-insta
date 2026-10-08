'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import DataTable from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import Modal from '@/components/ui/Modal';
import { Btn, Field, Tabs, inputCls } from '@/components/finance/ui';
import { fmtAmount, fmtDateTime, usePlatformMutation } from '@/components/platform/ui';
import { useRouter } from '@/i18n/navigation';
import { useAuthStore } from '@/stores/auth.store';
import {
  APPROVAL_DOCUMENT_TYPES,
  approvalsService,
  platformLookups,
  type ApprovalRequest,
} from '@/services/platform.service';

const STATUS_BADGE: Record<string, string> = { pending: 'pending', approved: 'approved', rejected: 'rejected', cancelled: 'cancelled' };

/** Approval inbox: requests waiting for me (approve / reject with a comment) and the history. */
export default function ApprovalRequestsPage() {
  const t = useTranslations('appr');
  const tp = useTranslations('platform');
  const router = useRouter();
  const me = useAuthStore((s) => s.user);
  const [tab, setTab] = useState<'mine' | 'my-requests' | 'all'>('mine');
  const [filters, setFilters] = useState({ status: '', documentType: '' });
  const { data: users = [] } = useQuery({ queryKey: ['platform-users'], queryFn: platformLookups.users, staleTime: 60_000, retry: false });
  const userName = (id: string) => users.find((u) => u.id === id)?.name ?? '';
  const pending = useQuery({ queryKey: ['approval-requests', 'mine'], queryFn: approvalsService.myPending, enabled: tab === 'mine' });
  const all = useQuery({
    queryKey: ['approval-requests', tab, filters],
    queryFn: () => approvalsService.requests({ ...filters, requestedBy: tab === 'my-requests' ? me?.id : undefined }),
    enabled: tab !== 'mine',
  });
  const rows = (tab === 'mine' ? pending.data : all.data) ?? [];
  const loading = tab === 'mine' ? pending.isLoading : all.isLoading;

  const [deciding, setDeciding] = useState<{ request: ApprovalRequest; action: 'approve' | 'reject' } | null>(null);
  const [comment, setComment] = useState('');
  const decide = usePlatformMutation(
    () =>
      deciding!.action === 'approve'
        ? approvalsService.approve(deciding!.request.id, comment || undefined)
        : approvalsService.reject(deciding!.request.id, comment || undefined),
    {
      invalidate: ['approval-requests'],
      success: false,
      onSuccess: (r) => {
        setDeciding(null);
        toast.success(t(`decided_${r.status}`));
      },
    },
  );

  const columns = [
    { key: 'requestNumber', header: tp('common.number') },
    { key: 'documentType', header: t('documentType'), render: (r: ApprovalRequest) => t(`doc.${r.documentType}`) },
    { key: 'documentRef', header: t('document'), render: (r: ApprovalRequest) => r.documentRef || r.description || '-' },
    { key: 'amount', header: tp('common.amount'), render: (r: ApprovalRequest) => <span dir="ltr">{fmtAmount(r.amount)}</span> },
    { key: 'requestedBy', header: t('requestedBy'), render: (r: ApprovalRequest) => userName(r.requestedBy) },
    { key: 'createdAt', header: tp('common.date'), render: (r: ApprovalRequest) => fmtDateTime(r.createdAt) },
    {
      key: 'currentLevel',
      header: t('level'),
      render: (r: ApprovalRequest) => `${Math.min(r.currentLevel, r.levels?.length ?? r.currentLevel)} / ${r.levels?.length ?? '-'}`,
    },
    { key: 'status', header: tp('common.status'), render: (r: ApprovalRequest) => <StatusBadge status={STATUS_BADGE[r.status]} label={t(`status.${r.status}`)} /> },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-4">{t('requestsTitle')}</h1>
      <Tabs
        tabs={[
          { key: 'mine', label: t('waitingForMe') + (pending.data?.length ? ` (${pending.data.length})` : '') },
          { key: 'my-requests', label: t('myRequests') },
          { key: 'all', label: t('allRequests') },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab !== 'mine' && (
        <div className="flex flex-wrap gap-3 mb-4">
          <Field label={tp('common.status')} className="w-40">
            <select className={inputCls} value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
              <option value="">{tp('common.all')}</option>
              {['pending', 'approved', 'rejected', 'cancelled'].map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('documentType')} className="w-52">
            <select className={inputCls} value={filters.documentType} onChange={(e) => setFilters({ ...filters, documentType: e.target.value })}>
              <option value="">{tp('common.all')}</option>
              {APPROVAL_DOCUMENT_TYPES.map((d) => (
                <option key={d} value={d}>
                  {t(`doc.${d}`)}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}
      {tab === 'mine' && !loading && rows.length === 0 && <p className="text-sm text-gray-500 mb-3">{t('nothingWaiting')}</p>}
      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        searchable
        pageSize={20}
        onRowClick={(r) => router.push(`/approvals/requests/${r.id}`)}
        actions={(r) => (
          <div className="flex gap-1">
            {tab === 'mine' && r.status === 'pending' && (
              <>
                <Btn
                  size="sm"
                  variant="success"
                  onClick={() => {
                    setComment('');
                    setDeciding({ request: r, action: 'approve' });
                  }}
                >
                  {t('approve')}
                </Btn>
                <Btn
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    setComment('');
                    setDeciding({ request: r, action: 'reject' });
                  }}
                >
                  {t('reject')}
                </Btn>
              </>
            )}
            <Btn size="sm" variant="ghost" onClick={() => router.push(`/approvals/requests/${r.id}`)}>
              {tp('common.view')}
            </Btn>
          </div>
        )}
      />

      <Modal
        isOpen={!!deciding}
        onClose={() => setDeciding(null)}
        title={deciding ? `${t(deciding.action)}: ${deciding.request.requestNumber}` : ''}
        size="sm"
      >
        {deciding && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              {t(`doc.${deciding.request.documentType}`)} · {deciding.request.documentRef || deciding.request.description} ·{' '}
              <span dir="ltr">{fmtAmount(deciding.request.amount)}</span>
            </p>
            <Field label={tp('common.comment')} hint={deciding.action === 'reject' ? t('rejectCommentHint') : undefined}>
              <textarea className={inputCls} rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-3">
              <Btn variant="secondary" onClick={() => setDeciding(null)}>
                {tp('common.cancel')}
              </Btn>
              <Btn variant={deciding.action === 'approve' ? 'success' : 'danger'} disabled={decide.isPending} onClick={() => decide.mutate(undefined)}>
                {t(deciding.action)}
              </Btn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
