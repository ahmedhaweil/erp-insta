'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import Modal from '@/components/ui/Modal';
import { Field, FormActions, Input, Select, Toolbar, currentPeriod, useMoney } from '@/components/people/ui';
import { useBranches, useDepartments, useLabelMap, usePeopleMutation, usePeopleQuery } from '@/hooks/use-people';
import { hrService, type PayrollRun } from '@/services/people-hr.service';

const RUN_STATUSES = ['draft', 'approved', 'paid', 'cancelled', 'reversed'];

export default function PayrollRunsPage() {
  const t = useTranslations('hr');
  const tc = useTranslations('common');
  const tp = useTranslations('people');
  const router = useRouter();
  const money = useMoney();
  const [filters, setFilters] = useState({ period: '', status: '' });
  const { data = [], isLoading } = usePeopleQuery(['hr-payroll-runs', filters], () => hrService.runs(filters));
  const { data: branches } = useBranches();
  const { data: departments } = useDepartments();
  const branchMap = useLabelMap(branches, false);
  const deptMap = useLabelMap(departments, false);
  const blank = { period: currentPeriod(), branchId: '', departmentId: '', notes: '' };
  const [form, setForm] = useState(blank);
  const [open, setOpen] = useState(false);

  const create = usePeopleMutation((body: typeof blank) => hrService.createRun(body), {
    invalidate: ['hr-payroll-runs'],
    success: t('runCreated'),
    onSuccess: (run) => router.push(`/hr/payroll-runs/${run.id}`),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(form);
  };

  return (
    <div>
      <PageHeader title={t('payrollRuns')} action={{ label: t('newRun'), onClick: () => { setForm(blank); setOpen(true); } }} />
      <Toolbar>
        <Field label={t('period')}>
          <Input type="month" value={filters.period} onChange={(e) => setFilters((f) => ({ ...f, period: e.target.value }))} />
        </Field>
        <Field label={tc('status')}>
          <Select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} placeholder={tc('all')} options={RUN_STATUSES.map((s) => ({ value: s, label: t(`run_${s}`) }))} />
        </Field>
      </Toolbar>
      <DataTable<PayrollRun>
        data={data}
        loading={isLoading}
        onRowClick={(r) => router.push(`/hr/payroll-runs/${r.id}`)}
        columns={[
          { key: 'runNumber', header: t('runNumber') },
          { key: 'period', header: t('period') },
          { key: 'branchId', header: t('branch'), render: (r) => (r.branchId ? branchMap.get(r.branchId) : tp('allBranches')) },
          { key: 'departmentId', header: t('department'), render: (r) => (r.departmentId ? deptMap.get(r.departmentId) : tp('allDepartments')) },
          { key: 'employeeCount', header: t('employeeCount') },
          { key: 'totalGross', header: t('gross'), render: (r) => money(r.totalGross) },
          { key: 'totalNet', header: t('net'), render: (r) => money(r.totalNet) },
          { key: 'status', header: tc('status'), render: (r) => <StatusBadge status={r.status === 'reversed' ? 'refunded' : r.status} label={t(`run_${r.status}`)} /> },
        ]}
      />
      <Modal isOpen={open} onClose={() => setOpen(false)} title={t('newRun')}>
        <form onSubmit={submit} className="space-y-4">
          <Field label={t('period')} required>
            <Input type="month" required value={form.period} onChange={(e) => setForm((f) => ({ ...f, period: e.target.value }))} />
          </Field>
          <Field label={t('branch')}>
            <Select value={form.branchId} onChange={(e) => setForm((f) => ({ ...f, branchId: e.target.value }))} placeholder={tp('allBranches')} options={[...branchMap].map(([value, label]) => ({ value, label }))} />
          </Field>
          <Field label={t('department')}>
            <Select value={form.departmentId} onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))} placeholder={tp('allDepartments')} options={[...deptMap].map(([value, label]) => ({ value, label }))} />
          </Field>
          <Field label={tc('notes')}>
            <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </Field>
          <p className="text-xs text-gray-500">{t('newRunHint')}</p>
          <FormActions onCancel={() => setOpen(false)} submitting={create.isPending} submitLabel={t('computeRun')} />
        </form>
      </Modal>
    </div>
  );
}
