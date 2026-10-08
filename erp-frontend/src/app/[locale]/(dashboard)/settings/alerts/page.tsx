'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Play, Search } from 'lucide-react';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import StatusBadge from '@/components/ui/StatusBadge';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { Btn, Field, Tabs, inputCls } from '@/components/finance/ui';
import { fmtDateTime, usePlatformMutation } from '@/components/platform/ui';
import { Link } from '@/i18n/navigation';
import { alertsService, platformLookups, type AlertDelivery, type AlertRule, type AlertScanResult } from '@/services/platform.service';

const SEVERITIES = ['info', 'warning', 'error', 'success'] as const;
const emptyForm = {
  type: '',
  name: '',
  isActive: true,
  thresholdDays: '',
  thresholdHours: '',
  severity: '',
  recipientUserIds: [] as string[],
  recipientRoleIds: [] as string[],
  params: {} as Record<string, string>,
};

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

/** Scheduled alert rules (cheques due, overdue invoices, low stock...) and the alerts sent. */
export default function AlertsPage() {
  const t = useTranslations('alerts');
  const tp = useTranslations('platform');
  const locale = useLocale();
  const bi = (v?: { en: string; ar: string } | null) => (v ? (locale === 'ar' ? v.ar : v.en) : '');
  const [tab, setTab] = useState<'rules' | 'deliveries'>('rules');
  const { data: types = [] } = useQuery({ queryKey: ['alert-types'], queryFn: alertsService.types, staleTime: 300_000 });
  const { data: rules = [], isLoading } = useQuery({ queryKey: ['alert-rules'], queryFn: alertsService.rules });
  const { data: users = [] } = useQuery({ queryKey: ['platform-users'], queryFn: platformLookups.users, staleTime: 60_000, retry: false });
  const { data: roles = [] } = useQuery({ queryKey: ['platform-roles'], queryFn: platformLookups.roles, staleTime: 60_000, retry: false });
  const [delivFilter, setDelivFilter] = useState({ ruleId: '', from: daysAgo(7) });
  const deliveries = useQuery({
    queryKey: ['alert-deliveries', delivFilter],
    queryFn: () => alertsService.deliveries({ ruleId: delivFilter.ruleId || undefined, from: delivFilter.from || undefined }),
    enabled: tab === 'deliveries',
  });
  const needsWarehouses = types.some((x) => (x.params ?? []).some((p) => p.startsWith('warehouseId')));
  const { data: warehouses = [] } = useQuery({
    queryKey: ['platform-warehouses'],
    queryFn: platformLookups.warehouses,
    enabled: needsWarehouses,
    staleTime: 60_000,
    retry: false,
  });
  const typeDef = (type: string) => types.find((x) => x.type === type);
  const userName = (id: string) => users.find((u) => u.id === id)?.name ?? id.slice(0, 8);
  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? id.slice(0, 8);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AlertRule | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [deleting, setDeleting] = useState<AlertRule | null>(null);
  const [scanResult, setScanResult] = useState<{ dryRun: boolean; results: AlertScanResult[] } | null>(null);
  const def = typeDef(form.type);

  const startNew = () => {
    setEditing(null);
    setForm({ ...emptyForm, type: types[0]?.type ?? '' });
    setOpen(true);
  };
  const startEdit = (r: AlertRule) => {
    setEditing(r);
    setForm({
      type: r.type,
      name: r.name ?? '',
      isActive: r.isActive,
      thresholdDays: r.thresholdDays != null ? String(r.thresholdDays) : '',
      thresholdHours: r.thresholdHours != null ? String(r.thresholdHours) : '',
      severity: r.severity ?? '',
      recipientUserIds: r.recipientUserIds ?? [],
      recipientRoleIds: r.recipientRoleIds ?? [],
      params: Object.fromEntries(Object.entries(r.params ?? {}).map(([k, v]) => [k, String(v ?? '')])),
    });
    setOpen(true);
  };

  const save = usePlatformMutation(
    () => {
      const params = Object.fromEntries(
        Object.entries(form.params)
          .filter(([, v]) => v !== '')
          .map(([k, v]) => [k, k === 'minAmount' ? Number(v) : v]),
      );
      const body: Record<string, unknown> = {
        name: form.name || undefined,
        isActive: form.isActive,
        thresholdDays: form.thresholdDays !== '' ? Number(form.thresholdDays) : null,
        thresholdHours: form.thresholdHours !== '' ? Number(form.thresholdHours) : null,
        severity: form.severity || null,
        recipientUserIds: form.recipientUserIds,
        recipientRoleIds: form.recipientRoleIds,
        params,
      };
      return editing ? alertsService.updateRule(editing.id, body) : alertsService.createRule({ ...body, type: form.type });
    },
    { invalidate: ['alert-rules'], onSuccess: () => setOpen(false) },
  );
  const remove = usePlatformMutation((id: string) => alertsService.deleteRule(id), { invalidate: ['alert-rules'], onSuccess: () => setDeleting(null) });
  const defaults = usePlatformMutation(() => alertsService.createDefaults(), { invalidate: ['alert-rules'], success: t('defaultsCreated') });
  const scan = usePlatformMutation(
    (arg: { ruleId?: string; dryRun: boolean }) => alertsService.scan(arg).then((results) => ({ dryRun: arg.dryRun, results })),
    { invalidate: ['alert-rules', 'alert-deliveries', 'my-notifications'], success: false, onSuccess: (r) => setScanResult(r) },
  );

  const recipients = (r: AlertRule) => {
    const parts = [...(r.recipientRoleIds ?? []).map(roleName), ...(r.recipientUserIds ?? []).map(userName)];
    return parts.length ? parts.join('، ') : t('defaultRecipients');
  };

  const ruleColumns = [
    { key: 'type', header: t('type'), render: (r: AlertRule) => bi(typeDef(r.type)?.title) || r.type },
    { key: 'name', header: tp('common.name'), render: (r: AlertRule) => r.name || '-' },
    {
      key: 'thresholdDays',
      header: t('threshold'),
      render: (r: AlertRule) => {
        const d = typeDef(r.type);
        if (d?.days) return `${r.thresholdDays ?? d.days.default} · ${bi(d.days.meaning)}`;
        if (d?.hours) return `${r.thresholdHours ?? d.hours.default} · ${bi(d.hours.meaning)}`;
        return '-';
      },
    },
    { key: 'recipients', header: t('recipients'), render: recipients },
    { key: 'lastRunAt', header: t('lastRun'), render: (r: AlertRule) => (r.lastRunAt ? `${fmtDateTime(r.lastRunAt)} (${r.lastMatchCount})` : '-') },
    {
      key: 'isActive',
      header: tp('common.status'),
      render: (r: AlertRule) => <StatusBadge status={r.isActive ? 'active' : 'inactive'} label={r.isActive ? tp('common.active') : tp('common.inactive')} />,
    },
  ];

  const ruleName = (id: string) => {
    const r = rules.find((x) => x.id === id);
    return r ? r.name || bi(typeDef(r.type)?.title) : id.slice(0, 8);
  };
  const deliveryColumns = [
    { key: 'alertDate', header: tp('common.date') },
    { key: 'ruleId', header: t('rule'), render: (d: AlertDelivery) => ruleName(d.ruleId) },
    { key: 'alertType', header: t('type'), render: (d: AlertDelivery) => bi(typeDef(d.alertType)?.title) || d.alertType },
    { key: 'recordKey', header: t('record'), render: (d: AlertDelivery) => <span className="font-mono text-xs" dir="ltr">{d.recordKey}</span> },
    { key: 'userId', header: tp('common.user'), render: (d: AlertDelivery) => userName(d.userId) },
    { key: 'createdAt', header: t('sentAt'), render: (d: AlertDelivery) => fmtDateTime(d.createdAt) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
          <p className="text-sm text-gray-500">{t('intro')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Btn variant="secondary" disabled={defaults.isPending} onClick={() => defaults.mutate(undefined)}>
            {t('createDefaults')}
          </Btn>
          <Btn variant="secondary" disabled={scan.isPending} onClick={() => scan.mutate({ dryRun: true })}>
            <Search size={14} /> {t('dryRunAll')}
          </Btn>
          <Btn variant="secondary" disabled={scan.isPending} onClick={() => scan.mutate({ dryRun: false })}>
            <Play size={14} /> {t('scanAll')}
          </Btn>
          <Btn onClick={startNew}>{t('newRule')}</Btn>
        </div>
      </div>
      <Tabs
        tabs={[
          { key: 'rules', label: t('rulesTab') },
          { key: 'deliveries', label: t('deliveriesTab') },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'rules' && (
        <DataTable
          columns={ruleColumns}
          data={rules}
          loading={isLoading}
          onRowClick={startEdit}
          actions={(r) => (
            <div className="flex flex-wrap gap-1">
              <Btn size="sm" variant="ghost" onClick={() => scan.mutate({ ruleId: r.id, dryRun: true })}>
                {t('dryRun')}
              </Btn>
              <Btn size="sm" variant="ghost" onClick={() => scan.mutate({ ruleId: r.id, dryRun: false })}>
                {t('scanNow')}
              </Btn>
              <Btn size="sm" variant="ghost" onClick={() => startEdit(r)}>
                {tp('common.edit')}
              </Btn>
              <Btn size="sm" variant="ghost" onClick={() => setDeleting(r)}>
                {tp('common.delete')}
              </Btn>
            </div>
          )}
        />
      )}

      {tab === 'deliveries' && (
        <>
          <div className="flex flex-wrap gap-3">
            <Field label={t('rule')} className="w-56">
              <select className={inputCls} value={delivFilter.ruleId} onChange={(e) => setDelivFilter({ ...delivFilter, ruleId: e.target.value })}>
                <option value="">{tp('common.all')}</option>
                {rules.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name || bi(typeDef(r.type)?.title)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={tp('common.from')}>
              <input type="date" className={inputCls} value={delivFilter.from} onChange={(e) => setDelivFilter({ ...delivFilter, from: e.target.value })} />
            </Field>
          </div>
          <DataTable columns={deliveryColumns} data={deliveries.data ?? []} loading={deliveries.isLoading} searchable pageSize={25} />
        </>
      )}

      <Modal isOpen={open} onClose={() => setOpen(false)} title={editing ? t('editRule') : t('newRule')} size="lg">
        <div className="space-y-4">
          <Field label={t('type') + ' *'} hint={def ? bi(def.description) : undefined}>
            <select
              className={inputCls}
              disabled={!!editing}
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value, thresholdDays: '', thresholdHours: '', params: {} })}
            >
              {types.map((x) => (
                <option key={x.type} value={x.type}>
                  {bi(x.title)}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label={tp('common.name')} hint={t('nameHint')}>
              <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label={t('severity')}>
              <select className={inputCls} value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
                <option value="">{t('severityDefault', { severity: def ? t(`sev.${def.severity}`) : '' })}</option>
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {t(`sev.${s}`)}
                  </option>
                ))}
              </select>
            </Field>
            {def?.days && (
              <Field label={bi(def.days.meaning)} hint={t('defaultValue', { value: def.days.default })}>
                <input type="number" min={0} className={inputCls} value={form.thresholdDays} onChange={(e) => setForm({ ...form, thresholdDays: e.target.value })} />
              </Field>
            )}
            {def?.hours && (
              <Field label={bi(def.hours.meaning)} hint={t('defaultValue', { value: def.hours.default })}>
                <input type="number" min={0} className={inputCls} value={form.thresholdHours} onChange={(e) => setForm({ ...form, thresholdHours: e.target.value })} />
              </Field>
            )}
            {(def?.params ?? []).map((p) => {
              const key = p.split(' ')[0];
              const choices = /\(([^)]+)\)/.exec(p)?.[1]?.split('|').map((x) => x.trim());
              return (
                <Field key={key} label={t.has(`param.${key}`) ? t(`param.${key}`) : key}>
                  {key === 'warehouseId' ? (
                    <select className={inputCls} value={form.params[key] ?? ''} onChange={(e) => setForm({ ...form, params: { ...form.params, [key]: e.target.value } })}>
                      <option value="">{tp('common.all')}</option>
                      {warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.code} - {locale === 'ar' ? w.nameAr : w.nameEn || w.nameAr}
                        </option>
                      ))}
                    </select>
                  ) : choices ? (
                    <select className={inputCls} value={form.params[key] ?? ''} onChange={(e) => setForm({ ...form, params: { ...form.params, [key]: e.target.value } })}>
                      <option value="">{tp('common.all')}</option>
                      {choices.map((c) => (
                        <option key={c} value={c}>
                          {t.has(`paramValue.${c}`) ? t(`paramValue.${c}`) : c}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className={inputCls}
                      type={key === 'minAmount' ? 'number' : 'text'}
                      value={form.params[key] ?? ''}
                      onChange={(e) => setForm({ ...form, params: { ...form.params, [key]: e.target.value } })}
                    />
                  )}
                </Field>
              );
            })}
            <Field label={t('recipientRoles')} hint={t('recipientsHint')}>
              <select
                multiple
                className={inputCls + ' h-28'}
                value={form.recipientRoleIds}
                onChange={(e) => setForm({ ...form, recipientRoleIds: Array.from(e.target.selectedOptions).map((o) => o.value) })}
              >
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('recipientUsers')}>
              <select
                multiple
                className={inputCls + ' h-28'}
                value={form.recipientUserIds}
                onChange={(e) => setForm({ ...form, recipientUserIds: Array.from(e.target.selectedOptions).map((o) => o.value) })}
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
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
            {tp('common.active')}
          </label>
          <div className="flex justify-end gap-3">
            <Btn variant="secondary" onClick={() => setOpen(false)}>
              {tp('common.cancel')}
            </Btn>
            <Btn disabled={!form.type || save.isPending} onClick={() => save.mutate(undefined)}>
              {tp('common.save')}
            </Btn>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!scanResult} onClose={() => setScanResult(null)} title={scanResult?.dryRun ? t('dryRunResult') : t('scanResult')} size="lg">
        {scanResult && (
          <div className="space-y-3">
            {scanResult.results.length === 0 && <p className="text-sm text-gray-500">{t('noActiveRules')}</p>}
            {scanResult.results.map((r) => (
              <div key={r.ruleId} className="border border-gray-200 rounded-lg p-3 text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-semibold">{r.name || bi(typeDef(r.type)?.title)}</span>
                  <span className="text-gray-600">
                    {t('matches', { n: r.matches })}
                    {!scanResult.dryRun && ` · ${t('newRecords', { n: r.newRecords })} · ${t('notifiedUsers', { n: r.notifiedUsers })}`}
                  </span>
                </div>
                {r.items && r.items.length > 0 && (
                  <ul className="mt-2 list-disc ps-5 text-gray-700 max-h-40 overflow-y-auto">
                    {r.items.slice(0, 50).map((i) => (
                      <li key={i.recordKey}>{i.label}</li>
                    ))}
                  </ul>
                )}
                {typeDef(r.type)?.link && (
                  <Link href={typeDef(r.type)!.link} className="text-xs text-primary-600 hover:underline">
                    {t('openScreen')}
                  </Link>
                )}
              </div>
            ))}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        title={tp('common.delete')}
        message={t('deleteConfirm')}
        destructive
        loading={remove.isPending}
      />
    </div>
  );
}
