'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { Field, FormActions, Input, LinkButton, Select, Toolbar, currentPeriod, useMoney } from '@/components/people/ui';
import { useEmployeesLookup, useLabelMap, useLeaveTypes, usePeopleMutation, usePeopleQuery } from '@/hooks/use-people';
import { hrService, type LeaveEncashment } from '@/services/people-hr.service';

/** Leave encashment (صرف رصيد الإجازات): unused days paid through payroll as an addition. */
export default function LeaveEncashmentsPage() {
  const t = useTranslations('hr');
  const tc = useTranslations('common');
  const tp = useTranslations('people');
  const money = useMoney();
  const [filters, setFilters] = useState({ employeeId: '', period: '' });
  const { data = [], isLoading } = usePeopleQuery(['hr-encashments', filters], () => hrService.encashments(filters));
  const { data: employees } = useEmployeesLookup();
  const { data: types } = useLeaveTypes();
  const empMap = useLabelMap(employees);
  const typeMap = useLabelMap(types, false);
  const activeOptions = [...useLabelMap(employees?.filter((e) => e.status === 'active'))].map(([value, label]) => ({ value, label }));
  const encashableTypes = (types ?? []).filter((x) => x.encashable);
  const year = new Date().getFullYear();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ employeeId: '', leaveTypeId: '', year: String(year), days: '', period: currentPeriod(), dailyRate: '', notes: '' });
  const [cancelling, setCancelling] = useState<LeaveEncashment | null>(null);

  const { data: balances } = usePeopleQuery(
    ['hr-leave-balances', form.employeeId, form.year],
    () => hrService.employeeBalances(form.employeeId, Number(form.year)),
    open && !!form.employeeId && !!form.year,
  );
  const balance = balances?.find((b) => b.leaveTypeId === form.leaveTypeId);

  const invalidate = ['hr-encashments', 'hr-leave-balances', 'hr-payroll-adjustments'];
  const create = usePeopleMutation(
    () =>
      hrService.createEncashment({
        employeeId: form.employeeId,
        leaveTypeId: form.leaveTypeId,
        year: Number(form.year),
        days: Number(form.days),
        period: form.period,
        dailyRate: form.dailyRate ? Number(form.dailyRate) : undefined,
        notes: form.notes,
      }),
    { invalidate, success: t('encashmentCreated'), onSuccess: () => setOpen(false) },
  );
  const cancel = usePeopleMutation((id: string) => hrService.cancelEncashment(id), { invalidate, onSuccess: () => setCancelling(null) });

  return (
    <div>
      <PageHeader
        title={t('leaveEncashments')}
        action={{
          label: t('newEncashment'),
          onClick: () => {
            setForm({ employeeId: '', leaveTypeId: encashableTypes[0]?.id ?? '', year: String(year), days: '', period: currentPeriod(), dailyRate: '', notes: '' });
            setOpen(true);
          },
        }}
      />
      <p className="text-sm text-gray-500 -mt-4 mb-4">{t('encashmentIntro')}</p>
      <Toolbar>
        <Field label={t('employee')}>
          <Select value={filters.employeeId} onChange={(e) => setFilters((f) => ({ ...f, employeeId: e.target.value }))} placeholder={tc('all')} options={[...empMap].map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label={t('period')}>
          <Input type="month" value={filters.period} onChange={(e) => setFilters((f) => ({ ...f, period: e.target.value }))} />
        </Field>
      </Toolbar>
      <DataTable<LeaveEncashment>
        data={data}
        loading={isLoading}
        columns={[
          { key: 'employeeId', header: t('employee'), render: (r) => empMap.get(r.employeeId) ?? '-' },
          { key: 'leaveTypeId', header: t('leaveType'), render: (r) => typeMap.get(r.leaveTypeId) ?? '-' },
          { key: 'year', header: t('year') },
          { key: 'days', header: t('days'), render: (r) => Number(r.days) },
          { key: 'dailyRate', header: t('dailyRate'), render: (r) => money(r.dailyRate) },
          { key: 'amount', header: tc('amount'), render: (r) => money(r.amount) },
          { key: 'period', header: t('payrollPeriod') },
          { key: 'status', header: tc('status'), render: (r) => <StatusBadge status={r.status} label={t(`enc_${r.status}`)} /> },
        ]}
        actions={(r) =>
          r.status === 'approved' ? (
            <LinkButton className="text-red-600" onClick={() => setCancelling(r)}>
              {tc('cancel')}
            </LinkButton>
          ) : null
        }
      />

      <Modal isOpen={open} onClose={() => setOpen(false)} title={t('newEncashment')}>
        <form onSubmit={(e) => { e.preventDefault(); create.mutate(undefined); }} className="space-y-4">
          <Field label={t('employee')} required>
            <Select required value={form.employeeId} onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))} placeholder={tp('select')} options={activeOptions} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t('leaveType')} required hint={encashableTypes.length ? undefined : t('noEncashableTypes')}>
              <Select
                required
                value={form.leaveTypeId}
                onChange={(e) => setForm((f) => ({ ...f, leaveTypeId: e.target.value }))}
                placeholder={tp('select')}
                options={encashableTypes.map((x) => ({ value: x.id, label: typeMap.get(x.id) ?? x.code }))}
              />
            </Field>
            <Field label={t('year')} required>
              <Input type="number" required value={form.year} onChange={(e) => setForm((f) => ({ ...f, year: e.target.value }))} />
            </Field>
            <Field label={t('days')} required hint={balance ? t('remainingDays', { days: Number(balance.remaining) }) : undefined}>
              <Input type="number" required min={0.5} step="0.5" value={form.days} onChange={(e) => setForm((f) => ({ ...f, days: e.target.value }))} />
            </Field>
            <Field label={t('payrollPeriod')} required>
              <Input type="month" required value={form.period} onChange={(e) => setForm((f) => ({ ...f, period: e.target.value }))} />
            </Field>
            <Field label={t('dailyRate')} hint={t('dailyRateHint')}>
              <Input type="number" min={0} step="any" value={form.dailyRate} onChange={(e) => setForm((f) => ({ ...f, dailyRate: e.target.value }))} />
            </Field>
            <Field label={tc('notes')}>
              <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </Field>
          </div>
          <FormActions onCancel={() => setOpen(false)} submitting={create.isPending} />
        </form>
      </Modal>
      <ConfirmDialog
        isOpen={!!cancelling}
        onClose={() => setCancelling(null)}
        onConfirm={() => cancelling && cancel.mutate(cancelling.id)}
        title={tc('cancel')}
        message={t('cancelEncashmentConfirm')}
        destructive
        loading={cancel.isPending}
      />
    </div>
  );
}
