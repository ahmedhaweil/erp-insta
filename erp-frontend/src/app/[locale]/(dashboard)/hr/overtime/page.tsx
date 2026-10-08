'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import Modal from '@/components/ui/Modal';
import { Field, FormActions, Input, LinkButton, Select, Toolbar, todayIso } from '@/components/people/ui';
import { useEmployeesLookup, useLabelMap, usePeopleMutation, usePeopleQuery } from '@/hooks/use-people';
import { hrService, type OvertimeRequest } from '@/services/people-hr.service';

const STATUSES = ['draft', 'approved', 'rejected', 'cancelled'];

/** Overtime requests (طلبات العمل الإضافي): approved hours are paid by payroll. */
export default function OvertimePage() {
  const t = useTranslations('hr');
  const tc = useTranslations('common');
  const tp = useTranslations('people');
  const [filters, setFilters] = useState({ status: 'draft', employeeId: '', from: '', to: '' });
  const { data = [], isLoading } = usePeopleQuery(['hr-overtime', filters], () => hrService.overtime(filters));
  const { data: employees } = useEmployeesLookup();
  const empMap = useLabelMap(employees);
  const activeOptions = [...useLabelMap(employees?.filter((e) => e.status === 'active'))].map(([value, label]) => ({ value, label }));
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ employeeId: '', date: todayIso(), hours: '', reason: '' });
  const [deciding, setDeciding] = useState<{ request: OvertimeRequest; action: 'approve' | 'reject' } | null>(null);
  const [note, setNote] = useState('');

  const invalidate = ['hr-overtime'];
  const create = usePeopleMutation(
    () => hrService.createOvertime({ employeeId: form.employeeId, date: form.date, hours: Number(form.hours), reason: form.reason }),
    { invalidate, success: t('overtimeRequested'), onSuccess: () => setOpen(false) },
  );
  const decide = usePeopleMutation(
    (input: { id: string; action: 'approve' | 'reject'; note: string }) =>
      input.action === 'approve' ? hrService.approveOvertime(input.id, input.note || undefined) : hrService.rejectOvertime(input.id, input.note || undefined),
    { invalidate, onSuccess: () => setDeciding(null) },
  );
  const cancel = usePeopleMutation((id: string) => hrService.cancelOvertime(id), { invalidate });

  const totalHours = data.filter((r) => r.status === 'approved').reduce((s, r) => s + Number(r.hours), 0);

  return (
    <div>
      <PageHeader
        title={t('overtimeRequests')}
        action={{
          label: t('newOvertime'),
          onClick: () => {
            setForm({ employeeId: '', date: todayIso(), hours: '', reason: '' });
            setOpen(true);
          },
        }}
      />
      <Toolbar>
        <Field label={tc('status')}>
          <Select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} placeholder={tc('all')} options={STATUSES.map((s) => ({ value: s, label: t(`leave_${s}`) }))} />
        </Field>
        <Field label={t('employee')}>
          <Select value={filters.employeeId} onChange={(e) => setFilters((f) => ({ ...f, employeeId: e.target.value }))} placeholder={tc('all')} options={[...empMap].map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label={t('from')}>
          <Input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} />
        </Field>
        <Field label={t('to')}>
          <Input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} />
        </Field>
        {totalHours > 0 && <span className="text-sm text-gray-600 pb-2">{t('approvedHours', { hours: totalHours })}</span>}
      </Toolbar>
      <DataTable<OvertimeRequest>
        data={data}
        loading={isLoading}
        columns={[
          { key: 'employeeId', header: t('employee'), render: (r) => empMap.get(r.employeeId) ?? '-' },
          { key: 'date', header: tc('date') },
          { key: 'hours', header: t('hours'), render: (r) => Number(r.hours) },
          { key: 'reason', header: t('reason'), render: (r) => r.reason || '-' },
          { key: 'decisionNote', header: t('decisionNote'), render: (r) => r.decisionNote || '-' },
          { key: 'status', header: tc('status'), render: (r) => <StatusBadge status={r.status} label={t(`leave_${r.status}`)} /> },
        ]}
        actions={(r) => (
          <div className="flex gap-3">
            {r.status === 'draft' && (
              <>
                <LinkButton className="text-green-600" onClick={() => { setNote(''); setDeciding({ request: r, action: 'approve' }); }}>
                  {t('approve')}
                </LinkButton>
                <LinkButton className="text-amber-600" onClick={() => { setNote(''); setDeciding({ request: r, action: 'reject' }); }}>
                  {t('reject')}
                </LinkButton>
              </>
            )}
            {(r.status === 'draft' || r.status === 'approved') && (
              <LinkButton className="text-red-600" disabled={cancel.isPending} onClick={() => cancel.mutate(r.id)}>
                {tc('cancel')}
              </LinkButton>
            )}
          </div>
        )}
      />

      <Modal isOpen={open} onClose={() => setOpen(false)} title={t('newOvertime')}>
        <form onSubmit={(e) => { e.preventDefault(); create.mutate(undefined); }} className="space-y-4">
          <Field label={t('employee')} required>
            <Select required value={form.employeeId} onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))} placeholder={tp('select')} options={activeOptions} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label={tc('date')} required>
              <Input type="date" required value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
            </Field>
            <Field label={t('hours')} required>
              <Input type="number" required min={0.25} max={24} step="0.25" value={form.hours} onChange={(e) => setForm((f) => ({ ...f, hours: e.target.value }))} />
            </Field>
          </div>
          <Field label={t('reason')}>
            <Input value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
          </Field>
          <FormActions onCancel={() => setOpen(false)} submitting={create.isPending} />
        </form>
      </Modal>

      <Modal isOpen={!!deciding} onClose={() => setDeciding(null)} title={deciding ? `${t(deciding.action)}: ${empMap.get(deciding.request.employeeId) ?? ''}` : ''} size="sm">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (deciding) decide.mutate({ id: deciding.request.id, action: deciding.action, note });
          }}
          className="space-y-4"
        >
          <Field label={t('decisionNote')}>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <FormActions onCancel={() => setDeciding(null)} submitting={decide.isPending} submitLabel={deciding ? t(deciding.action) : undefined} />
        </form>
      </Modal>
    </div>
  );
}
