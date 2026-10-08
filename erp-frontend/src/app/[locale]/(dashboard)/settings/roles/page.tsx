'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Check, Ban, Trash2 } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { Btn, Card, Field, Spinner, inputCls } from '@/components/finance/ui';
import { useFinAction } from '@/hooks/use-finance';
import { adminService, type PermissionGrant, type Role } from '@/services/finance-admin.service';

type Effect = 'allow' | 'deny';
const keyOf = (module: string, screen?: string, action?: string) => [module, screen, action].filter(Boolean).join('|');

function toMap(grants: PermissionGrant[]): Record<string, Effect> {
  const out: Record<string, Effect> = {};
  for (const g of grants) {
    if (g.field) continue;
    out[keyOf(g.module, g.screen, g.action)] = g.effect ?? 'allow';
  }
  return out;
}

function toGrants(map: Record<string, Effect>, original: PermissionGrant[]): PermissionGrant[] {
  const grants: PermissionGrant[] = Object.entries(map).map(([k, effect]) => {
    const [module, screen, action] = k.split('|');
    return { module, ...(screen ? { screen } : {}), ...(action ? { action } : {}), effect };
  });
  // field-level grants are not edited here: keep them
  return [...grants, ...original.filter((g) => g.field)];
}

export default function RolesPage() {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const { data: roles = [], isLoading } = useQuery({ queryKey: ['roles'], queryFn: adminService.getRoles });
  const { data: catalog = [] } = useQuery({ queryKey: ['permission-catalog'], queryFn: adminService.getPermissionCatalog });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = roles.find((r) => r.id === selectedId) ?? null;
  const [map, setMap] = useState<Record<string, Effect>>({});
  const [meta, setMeta] = useState({ name: '', description: '' });
  const [showNew, setShowNew] = useState(false);
  const [newRole, setNewRole] = useState({ name: '', description: '' });
  const [confirmDelete, setConfirmDelete] = useState<Role | null>(null);

  useEffect(() => {
    if (!selectedId && roles.length) setSelectedId(roles[0].id);
  }, [roles, selectedId]);

  useEffect(() => {
    if (selected) {
      setMap(toMap(selected.permissions));
      setMeta({ name: selected.name, description: selected.description ?? '' });
    }
  }, [selected]);

  const allActions = useMemo(() => {
    const s = new Set<string>();
    catalog.forEach((m) => m.screens.forEach((sc) => sc.actions.forEach((a) => s.add(a))));
    const order = ['read', 'create', 'update', 'delete', 'post', 'approve', 'cancel'];
    return [...s].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b));
  }, [catalog]);

  const save = useFinAction(
    async () => {
      if (!selected) return;
      if (meta.name !== selected.name || meta.description !== (selected.description ?? '')) {
        await adminService.updateRole(selected.id, { name: meta.name, description: meta.description });
      }
      return adminService.setRolePermissions(selected.id, toGrants(map, selected.permissions));
    },
    { invalidate: ['roles'] },
  );
  const create = useFinAction(adminService.createRole, {
    invalidate: ['roles'],
    onSuccess: (r) => {
      setShowNew(false);
      setNewRole({ name: '', description: '' });
      setSelectedId(r.id);
    },
  });
  const remove = useFinAction(adminService.deleteRole, {
    invalidate: ['roles'],
    onSuccess: () => {
      setConfirmDelete(null);
      setSelectedId(null);
    },
  });

  const cycle = (k: string) =>
    setMap((m) => {
      const next = { ...m };
      if (!m[k]) next[k] = 'allow';
      else if (m[k] === 'allow') next[k] = 'deny';
      else delete next[k];
      return next;
    });

  const label = (group: 'modules' | 'screens' | 'actions', key: string) =>
    t.has(`${group}.${key}`) ? t(`${group}.${key}`) : key.replace(/[-_]/g, ' ');

  const EffectCell = ({ k, inherited }: { k: string; inherited?: Effect }) => {
    const eff = map[k];
    return (
      <button
        type="button"
        onClick={() => cycle(k)}
        title={eff ? t(eff) : inherited ? `${t('inherited')}: ${t(inherited)}` : t('notGranted')}
        className={clsx(
          'w-7 h-7 rounded-md border flex items-center justify-center mx-auto',
          eff === 'allow' && 'bg-green-500 border-green-600 text-white',
          eff === 'deny' && 'bg-red-500 border-red-600 text-white',
          !eff && inherited === 'allow' && 'bg-green-100 border-green-200 text-green-600',
          !eff && inherited === 'deny' && 'bg-red-100 border-red-200 text-red-600',
          !eff && !inherited && 'bg-white border-gray-300',
        )}
      >
        {(eff ?? inherited) === 'allow' && <Check size={14} />}
        {(eff ?? inherited) === 'deny' && <Ban size={14} />}
      </button>
    );
  };

  return (
    <div>
      <PageHeader title={t('rolesTitle')} action={{ label: t('newRole'), onClick: () => setShowNew(true) }} />
      {isLoading ? (
        <Spinner />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <Card title={t('roles')} className="lg:col-span-1 h-fit">
            <ul className="space-y-1">
              {roles.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(r.id)}
                    className={clsx(
                      'w-full text-start px-3 py-2 rounded-lg text-sm',
                      r.id === selectedId ? 'bg-primary-50 text-primary-700 font-medium' : 'hover:bg-gray-50',
                    )}
                  >
                    <div>{r.name}</div>
                    <div className="text-xs text-gray-500">
                      {t('usersCount', { count: r.userCount })}
                      {r.isSystemRole && ` · ${t('systemRole')}`}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          {selected && (
            <Card
              className="lg:col-span-3"
              title={selected.name}
              actions={
                <>
                  {!selected.isSystemRole && (
                    <Btn variant="secondary" onClick={() => setConfirmDelete(selected)}>
                      <Trash2 size={14} /> {tc('delete')}
                    </Btn>
                  )}
                  <Btn onClick={() => save.mutate(undefined)} disabled={save.isPending || !meta.name}>
                    {save.isPending ? tc('loading') : tc('save')}
                  </Btn>
                </>
              }
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <Field label={tc('name')}>
                  <input className={inputCls} value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} />
                </Field>
                <Field label={tc('description')}>
                  <input
                    className={inputCls}
                    value={meta.description}
                    onChange={(e) => setMeta({ ...meta, description: e.target.value })}
                  />
                </Field>
              </div>
              {selected.isSystemRole && selected.permissions.length === 0 && (
                <p className="mb-3 text-sm text-amber-700 bg-amber-50 rounded-lg p-3">{t('systemRoleHint')}</p>
              )}
              <p className="text-xs text-gray-500 mb-3">{t('matrixHint')}</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-start px-3 py-2 font-medium text-gray-600">{t('screen')}</th>
                      <th className="px-2 py-2 font-medium text-gray-600">{t('allActions')}</th>
                      {allActions.map((a) => (
                        <th key={a} className="px-2 py-2 font-medium text-gray-600 whitespace-nowrap">
                          {label('actions', a)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {catalog.map((m) => (
                      <Fragment key={m.module}>
                        <tr className="bg-gray-100/70 border-b border-gray-200">
                          <td className="px-3 py-2 font-semibold">{label('modules', m.module)}</td>
                          <td className="px-2 py-1">
                            <EffectCell k={keyOf(m.module)} />
                          </td>
                          <td colSpan={allActions.length} className="text-xs text-gray-500 px-2">
                            {t('wholeModule')}
                          </td>
                        </tr>
                        {m.screens.map((s) => {
                          const moduleEff = map[keyOf(m.module)];
                          const screenEff = map[keyOf(m.module, s.screen)] ?? moduleEff;
                          return (
                            <tr key={`${m.module}-${s.screen}`} className="border-b border-gray-100">
                              <td className="px-3 py-1.5 ps-8">{label('screens', s.screen)}</td>
                              <td className="px-2 py-1">
                                <EffectCell k={keyOf(m.module, s.screen)} inherited={moduleEff} />
                              </td>
                              {allActions.map((a) => (
                                <td key={a} className="px-2 py-1">
                                  {s.actions.includes(a) ? (
                                    <EffectCell k={keyOf(m.module, s.screen, a)} inherited={screenEff} />
                                  ) : null}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      <Modal isOpen={showNew} onClose={() => setShowNew(false)} title={t('newRole')}>
        <div className="space-y-4">
          <Field label={tc('name') + ' *'}>
            <input className={inputCls} value={newRole.name} onChange={(e) => setNewRole({ ...newRole, name: e.target.value })} />
          </Field>
          <Field label={tc('description')}>
            <input
              className={inputCls}
              value={newRole.description}
              onChange={(e) => setNewRole({ ...newRole, description: e.target.value })}
            />
          </Field>
          <div className="flex justify-end gap-3">
            <Btn variant="secondary" onClick={() => setShowNew(false)}>
              {tc('cancel')}
            </Btn>
            <Btn
              disabled={!newRole.name || create.isPending}
              onClick={() => create.mutate({ name: newRole.name, description: newRole.description || undefined, permissions: [] })}
            >
              {tc('save')}
            </Btn>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && remove.mutate(confirmDelete.id)}
        title={tc('delete')}
        message={tc('confirmDelete')}
        destructive
        loading={remove.isPending}
      />
    </div>
  );
}
