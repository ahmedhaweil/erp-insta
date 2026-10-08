'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import Modal from '@/components/ui/Modal';
import { Checkbox, Field, FormActions, Input, LinkButton, Select, Toolbar, currentPeriod, useMoney } from '@/components/people/ui';
import { useEmployeesLookup, useLabelMap, usePeopleMutation, usePeopleQuery } from '@/hooks/use-people';
import { hrService, type PayrollAdjustment } from '@/services/people-hr.service';

const CATEGORIES = ['bonus', 'commission', 'overtime', 'penalty', 'other'];

export default function PayrollAdjustmentsPage() {
  const t = useTranslations('hr');
  const tc = useTranslations('common');
  const tp = useTranslations('people');
  const money = useMoney();
  const [filters, setFilters] = useState({ period: currentPeriod(), employeeId: '' });
  const { data = [], isLoading } = usePeopleQuery(['hr-payroll-adjustments', filters], () => hrService.adjustments(filters));
  const { data: employees } = useEmployeesLookup();
  const empMap = useLabelMap(employees);
  const blank = { employeeId: '', period: currentPeriod(), kind: 'addition', category: 'bonus', description: '', amount: '', taxable: true };
  const [form, setForm] = useState(blank);
  const [open, setOpen] = useState(false);

  const create = usePeopleMutation((body: typeof blank) => hrService.createAdjustment({ ...body, amount: Number(body.amount) }), {
    invalidate: ['hr-payroll-adjustments'],
    onSuccess: () => setOpen(false),
  });
  const remove = usePeopleMutation((id: string) => hrService.deleteAdjustment(id), { invalidate: ['hr-payroll-adjustments'], success: tc('deleteSuccess') });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(form);
  };

  return (
    <div>
      <PageHeader title={t('payrollAdjustments')} action={{ label: t('newAdjustment'), onClick: () => { setForm({ ...blank, period: filters.period || currentPeriod() }); setOpen(true); } }} />
      <Toolbar>
        <Field label={t('period')}>
          <Input type="month" value={filters.period} onChange={(e) => setFilters((f) => ({ ...f, period: e.target.value }))} />
        </Field>
        <Field label={t('employee')}>
          <Select value={filters.employeeId} onChange={(e) => setFilters((f) => ({ ...f, employeeId: e.target.value }))} placeholder={tc('all')} options={[...empMap].map(([value, label]) => ({ value, label }))} />
        </Field>
      </Toolbar>
      <DataTable<PayrollAdjustment>
        data={data}
        loading={isLoading}
        columns={[
          { key: 'period', header: t('period') },
          { key: 'employeeId', header: t('employee'), render: (a) => empMap.get(a.employeeId) ?? '-' },
          { key: 'kind', header: t('kind'), render: (a) => <StatusBadge status={a.kind === 'addition' ? 'active' : 'overdue'} label={t(`kind_${a.kind}`)} /> },
          { key: 'category', header: t('category'), render: (a) => (CATEGORIES.includes(a.category) ? t(`category_${a.category}`) : a.category) },
          { key: 'description', header: tc('description') },
          { key: 'amount', header: tc('amount'), render: (a) => money(a.amount) },
          { key: 'taxable', header: t('taxable'), render: (a) => (a.taxable ? tc('yes') : tc('no')) },
          { key: 'payrollRunId', header: tc('status'), render: (a) => (a.payrollRunId ? t('consumed') : t('pendingRun')) },
        ]}
        actions={(a) =>
          !a.payrollRunId ? (
            <LinkButton className="text-red-600" onClick={() => remove.mutate(a.id)}>
              {tc('delete')}
            </LinkButton>
          ) : null
        }
      />
      <Modal isOpen={open} onClose={() => setOpen(false)} title={t('newAdjustment')}>
        <form onSubmit={submit} className="space-y-4">
          <Field label={t('employee')} required>
            <Select required value={form.employeeId} onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))} placeholder={tp('select')} options={[...empMap].map(([value, label]) => ({ value, label }))} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t('period')} required>
              <Input type="month" required value={form.period} onChange={(e) => setForm((f) => ({ ...f, period: e.target.value }))} />
            </Field>
            <Field label={t('kind')} required>
              <Select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value, category: e.target.value === 'deduction' ? 'penalty' : 'bonus' }))} options={['addition', 'deduction'].map((v) => ({ value: v, label: t(`kind_${v}`) }))} />
            </Field>
            <Field label={t('category')}>
              <Select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} options={CATEGORIES.map((v) => ({ value: v, label: t(`category_${v}`) }))} />
            </Field>
            <Field label={tc('amount')} required>
              <Input type="number" step="any" min="0.01" required value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
            </Field>
          </div>
          <Field label={tc('description')} required>
            <Input required value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </Field>
          {form.kind === 'addition' && <Checkbox label={t('taxableHint')} checked={form.taxable} onChange={(v) => setForm((f) => ({ ...f, taxable: v }))} />}
          <FormActions onCancel={() => setOpen(false)} submitting={create.isPending} />
        </form>
      </Modal>
    </div>
  );
}
