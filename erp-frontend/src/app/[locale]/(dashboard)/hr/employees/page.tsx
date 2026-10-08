'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import Modal from '@/components/ui/Modal';
import { Field, FormActions, Input, LinkButton, Select, Toolbar, todayIso, useMoney } from '@/components/people/ui';
import { useBranches, useDepartments, useJobTitles, useLabelMap, useLocalName, usePeopleMutation, usePeopleQuery } from '@/hooks/use-people';
import { hrService, type Employee } from '@/services/people-hr.service';
import ExportMenu from '@/components/platform/ExportMenu';

export default function EmployeesPage() {
  const t = useTranslations('hr');
  const tc = useTranslations('common');
  const tp = useTranslations('people');
  const router = useRouter();
  const name = useLocalName();
  const money = useMoney();
  const [filters, setFilters] = useState({ status: 'active', branchId: '', departmentId: '', search: '' });
  const { data = [], isLoading } = usePeopleQuery(['hr-employees', filters], () => hrService.employees(filters));
  const { data: branches } = useBranches();
  const { data: departments } = useDepartments();
  const { data: jobTitles } = useJobTitles();
  const branchMap = useLabelMap(branches, false);
  const deptMap = useLabelMap(departments, false);
  const jobMap = useLabelMap(jobTitles, false);
  const [terminating, setTerminating] = useState<Employee | null>(null);
  const [termination, setTermination] = useState({ terminationDate: todayIso(), terminationReason: '' });

  const terminate = usePeopleMutation(
    (input: { id: string; terminationDate: string; terminationReason: string }) =>
      hrService.terminateEmployee(input.id, { terminationDate: input.terminationDate, terminationReason: input.terminationReason }),
    { invalidate: ['hr-employees'], success: t('employeeTerminated'), onSuccess: () => setTerminating(null) },
  );

  const toOptions = (map: Map<string, string>) => [...map.entries()].map(([value, label]) => ({ value, label }));
  const set = (key: keyof typeof filters, value: string) => setFilters((f) => ({ ...f, [key]: value }));

  const submitTermination = (e: FormEvent) => {
    e.preventDefault();
    if (terminating) terminate.mutate({ id: terminating.id, ...termination });
  };

  return (
    <div>
      <PageHeader title={t('employees')} action={{ label: t('newEmployee'), onClick: () => router.push('/hr/employees/new') }} />
      <div className="flex justify-end -mt-3 mb-3">
        <ExportMenu entity="employees" />
      </div>
      <Toolbar>
        <Field label={tc('search')}>
          <Input value={filters.search} onChange={(e) => set('search', e.target.value)} placeholder={t('employeeSearchHint')} />
        </Field>
        <Field label={tc('status')}>
          <Select
            value={filters.status}
            onChange={(e) => set('status', e.target.value)}
            placeholder={tc('all')}
            options={[
              { value: 'active', label: t('status_active') },
              { value: 'terminated', label: t('status_terminated') },
            ]}
          />
        </Field>
        <Field label={t('branch')}>
          <Select value={filters.branchId} onChange={(e) => set('branchId', e.target.value)} placeholder={tc('all')} options={toOptions(branchMap)} />
        </Field>
        <Field label={t('department')}>
          <Select value={filters.departmentId} onChange={(e) => set('departmentId', e.target.value)} placeholder={tc('all')} options={toOptions(deptMap)} />
        </Field>
      </Toolbar>
      <DataTable<Employee>
        data={data}
        loading={isLoading}
        onRowClick={(e) => router.push(`/hr/employees/${e.id}`)}
        columns={[
          { key: 'code', header: tc('code') },
          { key: 'nameEn', header: tc('name'), render: (e) => name(e) },
          { key: 'departmentId', header: t('department'), render: (e) => (e.departmentId ? deptMap.get(e.departmentId) : '-') },
          { key: 'jobTitleId', header: t('jobTitle'), render: (e) => (e.jobTitleId ? jobMap.get(e.jobTitleId) : '-') },
          { key: 'hireDate', header: t('hireDate') },
          { key: 'payrollCountry', header: t('payrollCountry'), render: (e) => t(`country_${e.payrollCountry}`) },
          { key: 'basicSalary', header: t('basicSalary'), render: (e) => money(e.basicSalary) },
          { key: 'status', header: tc('status'), render: (e) => <StatusBadge status={e.status === 'active' ? 'active' : 'cancelled'} label={t(`status_${e.status}`)} /> },
        ]}
        actions={(e) => (
          <div className="flex gap-3">
            <LinkButton className="text-primary-600" onClick={() => router.push(`/hr/employees/${e.id}`)}>
              {tc('edit')}
            </LinkButton>
            {e.status === 'active' && (
              <LinkButton
                className="text-red-600"
                onClick={() => {
                  setTermination({ terminationDate: todayIso(), terminationReason: '' });
                  setTerminating(e);
                }}
              >
                {t('terminate')}
              </LinkButton>
            )}
          </div>
        )}
      />
      <Modal isOpen={!!terminating} onClose={() => setTerminating(null)} title={`${t('terminate')}: ${name(terminating)}`}>
        <form onSubmit={submitTermination} className="space-y-4">
          <Field label={t('terminationDate')} required>
            <Input type="date" required value={termination.terminationDate} onChange={(e) => setTermination((s) => ({ ...s, terminationDate: e.target.value }))} />
          </Field>
          <Field label={t('terminationReason')} required>
            <Input required value={termination.terminationReason} onChange={(e) => setTermination((s) => ({ ...s, terminationReason: e.target.value }))} />
          </Field>
          <p className="text-xs text-gray-500">{tp('irreversibleHint')}</p>
          <FormActions onCancel={() => setTerminating(null)} submitting={terminate.isPending} submitLabel={t('terminate')} />
        </form>
      </Modal>
    </div>
  );
}
