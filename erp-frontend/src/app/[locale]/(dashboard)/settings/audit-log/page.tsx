'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { Btn, Field, Toolbar, fmtDateTime, inputCls } from '@/components/finance/ui';
import { byId, useUsersLookup } from '@/hooks/use-finance';
import { adminService, type AuditLog } from '@/services/finance-admin.service';

const MODULES = ['accounting', 'treasury', 'payments', 'sales', 'purchasing', 'inventory', 'pos', 'hr', 'manufacturing', 'crm', 'compliance', 'settings', 'auth', 'reports'];

export default function AuditLogPage() {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const { data: users = [] } = useUsersLookup();
  const usersById = byId(users);

  const [draft, setDraft] = useState({ userId: '', module: '', recordId: '', from: '', to: '', limit: 200 });
  const [filters, setFilters] = useState(draft);
  const [detail, setDetail] = useState<AuditLog | null>(null);

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['audit-logs', filters],
    queryFn: () => adminService.getAuditLogs(filters),
  });

  /** Actions are stored as "<HTTP method> <handler>", e.g. "POST create". */
  const actionLabel = (a: string) => {
    const [method, handler = ''] = a.split(' ');
    const m = t.has(`auditActions.${method}`) ? t(`auditActions.${method}`) : method;
    return `${m} · ${handler}`;
  };

  const columns = [
    { key: 'createdAt', header: tc('date'), render: (l: AuditLog) => <span dir="ltr">{fmtDateTime(l.createdAt)}</span> },
    { key: 'userId', header: t('user'), render: (l: AuditLog) => usersById[l.userId]?.name ?? l.userId?.slice(0, 8) },
    { key: 'action', header: t('action'), render: (l: AuditLog) => actionLabel(l.action) },
    { key: 'module', header: t('module'), render: (l: AuditLog) => (t.has(`modules.${l.module}`) ? t(`modules.${l.module}`) : l.module) },
    { key: 'recordType', header: t('recordType') },
    { key: 'recordId', header: t('recordId'), render: (l: AuditLog) => <span className="font-mono text-xs">{l.recordId?.slice(0, 8)}</span> },
    { key: 'ipAddress', header: t('ip') },
  ];

  return (
    <div>
      <PageHeader title={t('auditTitle')} />
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
        <Toolbar>
          <Field label={t('user')} className="w-48">
            <select className={inputCls} value={draft.userId} onChange={(e) => setDraft({ ...draft, userId: e.target.value })}>
              <option value="">{tc('all')}</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('module')} className="w-44">
            <select className={inputCls} value={draft.module} onChange={(e) => setDraft({ ...draft, module: e.target.value })}>
              <option value="">{tc('all')}</option>
              {MODULES.map((m) => (
                <option key={m} value={m}>
                  {t.has(`modules.${m}`) ? t(`modules.${m}`) : m}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('recordId')} className="w-64">
            <input className={inputCls} dir="ltr" value={draft.recordId} onChange={(e) => setDraft({ ...draft, recordId: e.target.value.trim() })} />
          </Field>
          <Field label={t('from')}>
            <input type="date" className={inputCls} value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          </Field>
          <Field label={t('to')}>
            <input type="date" className={inputCls} value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          </Field>
          <Field label={t('limit')} className="w-24">
            <input
              type="number"
              className={inputCls}
              value={draft.limit}
              onChange={(e) => setDraft({ ...draft, limit: Number(e.target.value) || 100 })}
            />
          </Field>
          <Btn onClick={() => setFilters(draft)}>{tc('filter')}</Btn>
        </Toolbar>
      </div>
      <DataTable columns={columns} data={logs} loading={isLoading} searchable pageSize={25} onRowClick={setDetail} />

      <Modal isOpen={!!detail} onClose={() => setDetail(null)} title={t('auditDetail')} size="xl">
        {detail && (
          <div className="space-y-3 text-sm">
            <p>
              <b>{actionLabel(detail.action)}</b> · {detail.module} / {detail.recordType} ·{' '}
              <span dir="ltr">{fmtDateTime(detail.createdAt)}</span>
            </p>
            {detail.userAgent && <p className="text-xs text-gray-500" dir="ltr">{detail.userAgent}</p>}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <h4 className="font-medium mb-1">{t('oldValue')}</h4>
                <pre className="bg-gray-50 rounded-lg p-3 text-xs overflow-auto max-h-96" dir="ltr">
                  {detail.oldValue ? JSON.stringify(detail.oldValue, null, 2) : '-'}
                </pre>
              </div>
              <div>
                <h4 className="font-medium mb-1">{t('newValue')}</h4>
                <pre className="bg-gray-50 rounded-lg p-3 text-xs overflow-auto max-h-96" dir="ltr">
                  {detail.newValue ? JSON.stringify(detail.newValue, null, 2) : '-'}
                </pre>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
