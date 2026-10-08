'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import Modal from '@/components/ui/Modal';
import { Field, FormActions, Input, LinkButton, Select, Toolbar, todayIso } from '@/components/people/ui';
import { useEmployeesLookup, useLabelMap, useLeaveTypes, usePeopleMutation, usePeopleQuery } from '@/hooks/use-people';
import { hrService, type LeaveRequest } from '@/services/people-hr.service';

const STATUSES = ['draft', 'approved', 'rejected', 'cancelled'];

export default function LeaveRequestsPage() {
  const t = useTranslations('hr');
  const tc = useTranslations('common');
  const tp = useTranslations('people');
  const [filters, setFilters] = useState({ status: '', employeeId: '' });
  const { data = [], isLoading } = usePeopleQuery(['hr-leave-requests', filters], () => hrService.leaveRequests(filters));
  const { data: employees } = useEmployeesLookup();
  const { data: types } = useLeaveTypes();
  const empMap = useLabelMap(employees);
  const typeMap = useLabelMap(types, false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ employeeId: '', leaveTypeId: '', startDate: todayIso(), endDate: todayIso(), reason: '' });
  const [deciding, setDeciding] = useState<{ request: LeaveRequest; action: 'approve' | 'reject' } | null>(null);
  const [note, setNote] = useState('');

  const invalidate = ['hr-leave-requests', 'hr-leave-balances'];
  const create = usePeopleMutation((body: typeof form) => hrService.createLeaveRequest(body), {
    invalidate,
    success: t('leaveRequested'),
    onSuccess: () => setOpen(false),
  });
  const decide = usePeopleMutation(
    (input: { id: string; action: 'approve' | 'reject'; note: string }) =>
      input.action === 'approve' ? hrService.approveLeave(input.id, input.note) : hrService.rejectLeave(input.id, input.note),
    { invalidate, onSuccess: () => setDeciding(null) },
  );
  const cancel = usePeopleMutation((id: string) => hrService.cancelLeave(id), { invalidate, success: t('leaveCancelled') });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(form);
  };
  const empOptions = [...useLabelMap(employees?.filter((e) => e.status === 'active'))].map(([value, label]) => ({ value, label }));

  return (
    <div>
      <PageHeader
        title={t('leaveRequests')}
        action={{
          label: t('newLeaveRequest'),
          onClick: () => {
            setForm({ employeeId: '', leaveTypeId: '', startDate: todayIso(), endDate: todayIso(), reason: '' });
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
      </Toolbar>
      <DataTable<LeaveRequest>
        data={data}
        loading={isLoading}
        columns={[
          { key: 'requestNumber', header: t('requestNumber') },
          { key: 'employeeId', header: t('employee'), render: (r) => empMap.get(r.employeeId) ?? '-' },
          { key: 'leaveTypeId', header: t('leaveType'), render: (r) => typeMap.get(r.leaveTypeId) ?? '-' },
          { key: 'startDate', header: t('from') },
          { key: 'endDate', header: t('to') },
          { key: 'days', header: t('days'), render: (r) => Number(r.days) },
          { key: 'reason', header: t('reason'), render: (r) => r.reason || r.decisionNote || '-' },
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

      <Modal isOpen={open} onClose={() => setOpen(false)} title={t('newLeaveRequest')}>
        <form onSubmit={submit} className="space-y-4">
          <Field label={t('employee')} required>
            <Select required value={form.employeeId} onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))} placeholder={tp('select')} options={empOptions} />
          </Field>
          <Field label={t('leaveType')} required>
            <Select required value={form.leaveTypeId} onChange={(e) => setForm((f) => ({ ...f, leaveTypeId: e.target.value }))} placeholder={tp('select')} options={[...typeMap].map(([value, label]) => ({ value, label }))} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t('from')} required>
              <Input type="date" required value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
            </Field>
            <Field label={t('to')} required>
              <Input type="date" required value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
            </Field>
          </div>
          <Field label={t('reason')}>
            <Input value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
          </Field>
          <FormActions onCancel={() => setOpen(false)} submitting={create.isPending} />
        </form>
      </Modal>

      <Modal isOpen={!!deciding} onClose={() => setDeciding(null)} title={deciding ? `${t(deciding.action)}: ${deciding.request.requestNumber}` : ''} size="sm">
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
