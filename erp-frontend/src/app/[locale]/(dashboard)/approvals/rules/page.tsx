'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import StatusBadge from '@/components/ui/StatusBadge';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { Btn, Field, inputCls } from '@/components/finance/ui';
import { fmtAmount, usePlatformMutation } from '@/components/platform/ui';
import {
  APPROVAL_DOCUMENT_TYPES,
  approvalsService,
  platformLookups,
  type ApprovalDocumentType,
  type ApprovalRule,
} from '@/services/platform.service';

type LevelDraft = { name: string; roleId: string; userIds: string[]; minApprovers: string };
const emptyLevel = (): LevelDraft => ({ name: '', roleId: '', userIds: [], minApprovers: '1' });
const emptyForm = {
  name: '',
  documentType: 'purchase_order' as ApprovalDocumentType,
  minAmount: '0',
  maxAmount: '',
  priority: '100',
  allowSelfApproval: false,
  isActive: true,
  description: '',
};

/** Approval rules: which documents need approval, above which amount, by whom (levels). */
export default function ApprovalRulesPage() {
  const t = useTranslations('appr');
  const tp = useTranslations('platform');
  const { data: rules = [], isLoading } = useQuery({ queryKey: ['approval-rules'], queryFn: () => approvalsService.rules() });
  const { data: roles = [] } = useQuery({ queryKey: ['platform-roles'], queryFn: platformLookups.roles, staleTime: 60_000 });
  const { data: users = [] } = useQuery({ queryKey: ['platform-users'], queryFn: platformLookups.users, staleTime: 60_000 });
  const roleName = (id?: string | null) => roles.find((r) => r.id === id)?.name ?? '';
  const userName = (id: string) => users.find((u) => u.id === id)?.name ?? id.slice(0, 8);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ApprovalRule | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [levels, setLevels] = useState<LevelDraft[]>([emptyLevel()]);
  const [deactivating, setDeactivating] = useState<ApprovalRule | null>(null);

  const startNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setLevels([emptyLevel()]);
    setOpen(true);
  };
  const startEdit = (r: ApprovalRule) => {
    setEditing(r);
    setForm({
      name: r.name,
      documentType: r.documentType,
      minAmount: String(Number(r.minAmount)),
      maxAmount: r.maxAmount != null ? String(Number(r.maxAmount)) : '',
      priority: String(r.priority),
      allowSelfApproval: r.allowSelfApproval,
      isActive: r.isActive,
      description: r.description ?? '',
    });
    setLevels(
      [...(r.levels ?? [])]
        .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
        .map((l) => ({ name: l.name ?? '', roleId: l.roleId ?? '', userIds: l.userIds ?? [], minApprovers: String(l.minApprovers ?? 1) })),
    );
    setOpen(true);
  };

  const levelsValid = levels.length > 0 && levels.every((l) => (l.roleId || l.userIds.length) && Number(l.minApprovers) >= 1);
  const save = usePlatformMutation(
    () => {
      const body: Record<string, unknown> = {
        name: form.name,
        minAmount: Number(form.minAmount) || 0,
        priority: Number(form.priority) || 100,
        allowSelfApproval: form.allowSelfApproval,
        isActive: form.isActive,
        description: form.description || undefined,
        levels: levels.map((l, i) => ({
          sequence: i + 1,
          name: l.name || undefined,
          roleId: l.roleId || undefined,
          userIds: l.userIds.length ? l.userIds : undefined,
          minApprovers: Number(l.minApprovers) || 1,
        })),
      };
      if (form.maxAmount !== '') body.maxAmount = Number(form.maxAmount);
      if (editing) return approvalsService.updateRule(editing.id, body);
      return approvalsService.createRule({ ...body, documentType: form.documentType });
    },
    { invalidate: ['approval-rules'], onSuccess: () => setOpen(false) },
  );
  const deactivate = usePlatformMutation((id: string) => approvalsService.deactivateRule(id), {
    invalidate: ['approval-rules'],
    onSuccess: () => setDeactivating(null),
  });

  const setLevel = (i: number, patch: Partial<LevelDraft>) => setLevels((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const columns = [
    { key: 'name', header: tp('common.name') },
    { key: 'documentType', header: t('documentType'), render: (r: ApprovalRule) => t(`doc.${r.documentType}`) },
    {
      key: 'minAmount',
      header: t('amountRange'),
      render: (r: ApprovalRule) => (
        <span dir="ltr">
          {fmtAmount(r.minAmount)} – {r.maxAmount != null ? fmtAmount(r.maxAmount) : '∞'}
        </span>
      ),
    },
    {
      key: 'levels',
      header: t('levels'),
      render: (r: ApprovalRule) =>
        [...(r.levels ?? [])]
          .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
          .map((l) => l.name || roleName(l.roleId) || (l.userIds ?? []).map(userName).join(', '))
          .join(' ← '),
    },
    { key: 'priority', header: t('priority') },
    {
      key: 'isActive',
      header: tp('common.status'),
      render: (r: ApprovalRule) => <StatusBadge status={r.isActive ? 'active' : 'inactive'} label={r.isActive ? tp('common.active') : tp('common.inactive')} />,
    },
  ];

  return (
    <div>
      <PageHeader title={t('rulesTitle')} action={{ label: t('newRule'), onClick: startNew }} />
      <p className="text-sm text-gray-500 -mt-4 mb-4">{t('rulesIntro')}</p>
      <DataTable
        columns={columns}
        data={rules}
        loading={isLoading}
        searchable
        onRowClick={startEdit}
        actions={(r) => (
          <div className="flex gap-1">
            <Btn size="sm" variant="ghost" onClick={() => startEdit(r)}>
              {tp('common.edit')}
            </Btn>
            {r.isActive && (
              <Btn size="sm" variant="ghost" onClick={() => setDeactivating(r)}>
                {t('deactivate')}
              </Btn>
            )}
          </div>
        )}
      />

      <Modal isOpen={open} onClose={() => setOpen(false)} title={editing ? t('editRule') : t('newRule')} size="xl">
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label={tp('common.name') + ' *'}>
              <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label={t('documentType') + ' *'} hint={editing ? t('documentTypeLocked') : undefined}>
              <select
                className={inputCls}
                disabled={!!editing}
                value={form.documentType}
                onChange={(e) => setForm({ ...form, documentType: e.target.value as ApprovalDocumentType })}
              >
                {APPROVAL_DOCUMENT_TYPES.map((d) => (
                  <option key={d} value={d}>
                    {t(`doc.${d}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('priority')} hint={t('priorityHint')}>
              <input type="number" className={inputCls} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} />
            </Field>
            <Field label={t('minAmount')} hint={t('minAmountHint')}>
              <input type="number" min={0} step="any" className={inputCls} value={form.minAmount} onChange={(e) => setForm({ ...form, minAmount: e.target.value })} />
            </Field>
            <Field label={t('maxAmount')} hint={t('maxAmountHint')}>
              <input type="number" min={0} step="any" className={inputCls} value={form.maxAmount} onChange={(e) => setForm({ ...form, maxAmount: e.target.value })} />
            </Field>
            <Field label={tp('common.description')}>
              <input className={inputCls} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-6 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.allowSelfApproval} onChange={(e) => setForm({ ...form, allowSelfApproval: e.target.checked })} />
              {t('allowSelfApproval')}
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
              {tp('common.active')}
            </label>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">{t('levels')}</h3>
              <Btn size="sm" variant="ghost" onClick={() => setLevels((ls) => [...ls, emptyLevel()])}>
                <Plus size={14} /> {t('addLevel')}
              </Btn>
            </div>
            <p className="text-xs text-gray-500 mb-2">{t('levelsHint')}</p>
            <div className="space-y-3">
              {levels.map((l, i) => (
                <div key={i} className="border border-gray-200 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">{t('levelN', { n: i + 1 })}</span>
                    <button
                      type="button"
                      disabled={levels.length <= 1}
                      onClick={() => setLevels((ls) => ls.filter((_, idx) => idx !== i))}
                      className="p-1 text-gray-400 hover:text-red-600 disabled:opacity-30"
                      aria-label={tp('common.delete')}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <Field label={tp('common.name')}>
                      <input className={inputCls} value={l.name} onChange={(e) => setLevel(i, { name: e.target.value })} />
                    </Field>
                    <Field label={t('approverRole')}>
                      <select className={inputCls} value={l.roleId} onChange={(e) => setLevel(i, { roleId: e.target.value })}>
                        <option value="">-</option>
                        {roles.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label={t('approverUsers')}>
                      <select
                        multiple
                        className={inputCls + ' h-24'}
                        value={l.userIds}
                        onChange={(e) => setLevel(i, { userIds: Array.from(e.target.selectedOptions).map((o) => o.value) })}
                      >
                        {users
                          .filter((u) => u.isActive !== false)
                          .map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field label={t('minApprovers')}>
                      <input type="number" min={1} className={inputCls} value={l.minApprovers} onChange={(e) => setLevel(i, { minApprovers: e.target.value })} />
                    </Field>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <Btn variant="secondary" onClick={() => setOpen(false)}>
              {tp('common.cancel')}
            </Btn>
            <Btn disabled={!form.name || !levelsValid || save.isPending} onClick={() => save.mutate(undefined)}>
              {tp('common.save')}
            </Btn>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={!!deactivating}
        onClose={() => setDeactivating(null)}
        onConfirm={() => deactivating && deactivate.mutate(deactivating.id)}
        title={t('deactivate')}
        message={t('deactivateConfirm', { name: deactivating?.name ?? '' })}
        destructive
        loading={deactivate.isPending}
      />
    </div>
  );
}
