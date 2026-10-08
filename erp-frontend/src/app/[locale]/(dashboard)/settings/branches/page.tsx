'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import StatusBadge from '@/components/ui/StatusBadge';
import { Btn, Field, inputCls } from '@/components/finance/ui';
import { useBranches, useFinAction } from '@/hooks/use-finance';
import { adminService, type Branch } from '@/services/finance-admin.service';

const empty = { code: '', name: '', address: '', phone: '', isActive: true };

export default function BranchesPage() {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const { data: branches = [], isLoading } = useBranches();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [form, setForm] = useState(empty);

  const close = () => {
    setOpen(false);
    setEditing(null);
    setForm(empty);
  };

  const save = useFinAction(
    () => {
      if (editing) {
        // only the fields that changed; cleared optional fields are sent as null
        const patch: Record<string, unknown> = {};
        if (form.code !== editing.code) patch.code = form.code;
        if (form.name !== editing.name) patch.name = form.name;
        if (form.address !== (editing.address ?? '')) patch.address = form.address || null;
        if (form.phone !== (editing.phone ?? '')) patch.phone = form.phone || null;
        if (form.isActive !== editing.isActive) patch.isActive = form.isActive;
        return adminService.updateBranch(editing.id, patch);
      }
      return adminService.createBranch({
        code: form.code,
        name: form.name,
        address: form.address || undefined,
        phone: form.phone || undefined,
        isActive: form.isActive,
      });
    },
    { invalidate: ['branches', 'ops', 'people-branches'], onSuccess: close },
  );

  const startEdit = (b: Branch) => {
    setEditing(b);
    setForm({ code: b.code, name: b.name, address: b.address ?? '', phone: b.phone ?? '', isActive: b.isActive });
    setOpen(true);
  };

  const columns = [
    { key: 'code', header: tc('code') },
    { key: 'name', header: tc('name') },
    { key: 'address', header: tc('address') },
    { key: 'phone', header: tc('phone') },
    {
      key: 'isActive',
      header: tc('status'),
      render: (b: Branch) => <StatusBadge status={b.isActive ? 'active' : 'inactive'} label={b.isActive ? tc('active') : tc('inactive')} />,
    },
  ];

  return (
    <div>
      <PageHeader title={t('branchesTitle')} action={{ label: t('newBranch'), onClick: () => setOpen(true) }} />
      <DataTable
        columns={columns}
        data={branches}
        loading={isLoading}
        searchable
        onRowClick={startEdit}
        actions={(b) => (
          <Btn size="sm" variant="ghost" onClick={() => startEdit(b)}>
            {tc('edit')}
          </Btn>
        )}
      />
      <Modal isOpen={open} onClose={close} title={editing ? t('editBranch') : t('newBranch')}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label={tc('code') + ' *'}>
              <input className={inputCls} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            </Field>
            <Field label={tc('name') + ' *'}>
              <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
          </div>
          <Field label={tc('address')}>
            <input className={inputCls} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </Field>
          <Field label={tc('phone')}>
            <input className={inputCls} dir="ltr" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
            {tc('active')}
          </label>
          <div className="flex justify-end gap-3">
            <Btn variant="secondary" onClick={close}>
              {tc('cancel')}
            </Btn>
            <Btn disabled={!form.code || !form.name || save.isPending} onClick={() => save.mutate(undefined)}>
              {tc('save')}
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}
