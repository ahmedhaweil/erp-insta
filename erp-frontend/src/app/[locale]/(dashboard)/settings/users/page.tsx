'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import StatusBadge from '@/components/ui/StatusBadge';
import ActionDialog from '@/components/finance/ActionDialog';
import { Btn, Field, fmtDateTime, inputCls } from '@/components/finance/ui';
import { useBranches, useFinAction } from '@/hooks/use-finance';
import { adminService, type AdminUser, type RoleAssignment } from '@/services/finance-admin.service';

function RolesEditor({ value, onChange }: { value: RoleAssignment[]; onChange: (v: RoleAssignment[]) => void }) {
  const t = useTranslations('admin');
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: adminService.getRoles });
  const { data: branches = [] } = useBranches();

  const toggleRole = (roleId: string) => {
    onChange(value.some((r) => r.roleId === roleId) ? value.filter((r) => r.roleId !== roleId) : [...value, { roleId, branchIds: [] }]);
  };
  const toggleBranch = (roleId: string, branchId: string) => {
    onChange(
      value.map((r) => {
        if (r.roleId !== roleId) return r;
        const ids = r.branchIds ?? [];
        return { ...r, branchIds: ids.includes(branchId) ? ids.filter((b) => b !== branchId) : [...ids, branchId] };
      }),
    );
  };

  return (
    <div className="space-y-2">
      {roles.map((role) => {
        const assigned = value.find((r) => r.roleId === role.id);
        return (
          <div key={role.id} className="border border-gray-200 rounded-lg p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={!!assigned} onChange={() => toggleRole(role.id)} />
              {role.name}
              {role.description && <span className="text-xs text-gray-500 font-normal">— {role.description}</span>}
            </label>
            {assigned && branches.length > 0 && (
              <div className="mt-2 ms-6">
                <p className="text-xs text-gray-500 mb-1">{t('roleBranchesHint')}</p>
                <div className="flex flex-wrap gap-3">
                  {branches.map((b) => (
                    <label key={b.id} className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={(assigned.branchIds ?? []).includes(b.id)}
                        onChange={() => toggleBranch(role.id, b.id)}
                      />
                      {b.code} - {b.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const emptyForm = { name: '', email: '', password: '', phone: '' };

export default function UsersPage() {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const { data: users = [], isLoading } = useQuery({ queryKey: ['users'], queryFn: adminService.getUsers });
  const { data: branches = [] } = useBranches();

  const [editing, setEditing] = useState<AdminUser | 'new' | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [roles, setRoles] = useState<RoleAssignment[]>([]);
  const [resetFor, setResetFor] = useState<AdminUser | null>(null);

  const close = () => setEditing(null);
  const create = useFinAction(adminService.createUser, { invalidate: ['users', 'roles'], onSuccess: close });
  const update = useFinAction(
    async ({ id, data, roles }: { id: string; data: { name: string; phone?: string }; roles: RoleAssignment[] }) => {
      await adminService.updateUser(id, data);
      return adminService.setUserRoles(id, roles);
    },
    { invalidate: ['users', 'roles'], onSuccess: close },
  );
  const toggleActive = useFinAction((u: AdminUser) => adminService.updateUser(u.id, { isActive: !u.isActive }), {
    invalidate: ['users'],
  });
  const resetPassword = useFinAction(({ id, password }: { id: string; password: string }) => adminService.resetUserPassword(id, password), {
    invalidate: ['users'],
    success: t('passwordReset'),
    onSuccess: () => setResetFor(null),
  });

  const openNew = () => {
    setForm(emptyForm);
    setRoles([]);
    setEditing('new');
  };
  const openEdit = (u: AdminUser) => {
    setForm({ name: u.name, email: u.email, password: '', phone: u.phone ?? '' });
    setRoles(u.roles.map((r) => ({ roleId: r.roleId, branchIds: r.branchIds ?? [] })));
    setEditing(u);
  };

  const submit = () => {
    const cleanRoles = roles.map((r) => ({ roleId: r.roleId, branchIds: r.branchIds ?? [] }));
    if (editing === 'new') {
      create.mutate({ name: form.name, email: form.email, password: form.password, phone: form.phone || undefined, roles: cleanRoles });
    } else if (editing) {
      update.mutate({ id: editing.id, data: { name: form.name, phone: form.phone || undefined }, roles: cleanRoles });
    }
  };

  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? id.slice(0, 6);

  const columns = [
    { key: 'name', header: tc('name') },
    { key: 'email', header: tc('email') },
    {
      key: 'roles',
      header: t('roles'),
      sortable: false,
      render: (u: AdminUser) => (
        <div className="flex flex-wrap gap-1">
          {u.roles.map((r) => (
            <span key={r.roleId} className="px-2 py-0.5 rounded bg-primary-50 text-primary-700 text-xs">
              {r.name}
              {r.branchIds && r.branchIds.length > 0 && ` (${r.branchIds.map(branchName).join('، ')})`}
            </span>
          ))}
        </div>
      ),
    },
    {
      key: 'twoFaEnabled',
      header: t('twoFa'),
      render: (u: AdminUser) => (u.twoFaEnabled ? tc('yes') : tc('no')),
    },
    { key: 'lastLogin', header: t('lastLogin'), render: (u: AdminUser) => fmtDateTime(u.lastLogin) },
    {
      key: 'isActive',
      header: tc('status'),
      render: (u: AdminUser) => (
        <StatusBadge status={u.isActive ? 'active' : 'inactive'} label={u.isActive ? tc('active') : tc('inactive')} />
      ),
    },
  ];

  const saving = create.isPending || update.isPending;
  const valid = form.name && (editing !== 'new' || (form.email && form.password.length >= 8));

  return (
    <div>
      <PageHeader title={t('usersTitle')} action={{ label: t('newUser'), onClick: openNew }} />
      <DataTable
        columns={columns}
        data={users}
        loading={isLoading}
        searchable
        actions={(u) => (
          <div className="flex gap-1">
            <Btn size="sm" variant="ghost" onClick={() => openEdit(u)}>
              {tc('edit')}
            </Btn>
            <Btn size="sm" variant="ghost" onClick={() => toggleActive.mutate(u)} disabled={toggleActive.isPending}>
              {u.isActive ? t('deactivate') : t('activate')}
            </Btn>
            <Btn size="sm" variant="ghost" onClick={() => setResetFor(u)}>
              {t('resetPassword')}
            </Btn>
          </div>
        )}
      />

      <Modal isOpen={!!editing} onClose={close} title={editing === 'new' ? t('newUser') : t('editUser')} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label={tc('name') + ' *'}>
              <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label={tc('email') + ' *'}>
              <input
                className={inputCls}
                type="email"
                dir="ltr"
                disabled={editing !== 'new'}
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            {editing === 'new' && (
              <Field label={t('password') + ' *'} hint={t('passwordHint')}>
                <input
                  className={inputCls}
                  type="password"
                  dir="ltr"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </Field>
            )}
            <Field label={tc('phone')}>
              <input className={inputCls} dir="ltr" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-800 mb-2">{t('roles')}</h3>
            <RolesEditor value={roles} onChange={setRoles} />
          </div>
          <div className="flex justify-end gap-3">
            <Btn variant="secondary" onClick={close}>
              {tc('cancel')}
            </Btn>
            <Btn onClick={submit} disabled={saving || !valid}>
              {saving ? tc('loading') : tc('save')}
            </Btn>
          </div>
        </div>
      </Modal>

      <ActionDialog
        open={!!resetFor}
        title={`${t('resetPassword')} - ${resetFor?.name ?? ''}`}
        fields={[{ name: 'password', label: t('newPassword'), type: 'text', required: true }]}
        loading={resetPassword.isPending}
        onClose={() => setResetFor(null)}
        onSubmit={(v) => resetFor && resetPassword.mutate({ id: resetFor.id, password: v.password })}
      />
    </div>
  );
}
