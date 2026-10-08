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

const empty = { code: '', name: '', address: '', phone: '' };

export default function BranchesPage() {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const { data: branches = [], isLoading } = useBranches();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);

  const create = useFinAction(adminService.createBranch, {
    invalidate: ['branches'],
    onSuccess: () => {
      setOpen(false);
      setForm(empty);
    },
  });

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
      <DataTable columns={columns} data={branches} loading={isLoading} searchable />
      <Modal isOpen={open} onClose={() => setOpen(false)} title={t('newBranch')}>
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
          <div className="flex justify-end gap-3">
            <Btn variant="secondary" onClick={() => setOpen(false)}>
              {tc('cancel')}
            </Btn>
            <Btn
              disabled={!form.code || !form.name || create.isPending}
              onClick={() =>
                create.mutate({ code: form.code, name: form.name, address: form.address || undefined, phone: form.phone || undefined })
              }
            >
              {tc('save')}
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}
