'use client';

import { useTranslations } from 'next-intl';
import SimpleCrud from '@/components/people/SimpleCrud';
import StatusBadge from '@/components/ui/StatusBadge';
import { hrService, type Department } from '@/services/people-hr.service';
import { useBranches, useDepartments, useEmployeesLookup, useLabelMap, useLocalName } from '@/hooks/use-people';

export default function DepartmentsPage() {
  const t = useTranslations('hr');
  const tc = useTranslations('common');
  const name = useLocalName();
  const { data: departments } = useDepartments();
  const { data: branches } = useBranches();
  const { data: employees } = useEmployeesLookup('active');
  const deptMap = useLabelMap(departments);
  const branchMap = useLabelMap(branches);
  const empMap = useLabelMap(employees);
  const toOptions = (map: Map<string, string>) => [...map.entries()].map(([value, label]) => ({ value, label }));

  return (
    <SimpleCrud<Department>
      title={t('departments')}
      newLabel={t('newDepartment')}
      queryKey="hr-departments"
      load={hrService.departments}
      create={hrService.createDepartment}
      update={hrService.updateDepartment}
      fields={[
        { name: 'code', label: tc('code'), required: true },
        { name: 'name', label: t('nameEn'), required: true },
        { name: 'nameAr', label: t('nameAr') },
        { name: 'parentId', label: t('parentDepartment'), type: 'select', options: toOptions(deptMap) },
        { name: 'branchId', label: t('branch'), type: 'select', options: toOptions(branchMap) },
        { name: 'managerId', label: t('manager'), type: 'select', options: toOptions(empMap) },
        { name: 'isActive', label: tc('active'), type: 'checkbox', defaultValue: true },
      ]}
      columns={[
        { key: 'code', header: tc('code') },
        { key: 'name', header: tc('name'), render: (d) => name(d) },
        { key: 'parentId', header: t('parentDepartment'), render: (d) => (d.parentId ? deptMap.get(d.parentId) : '-') },
        { key: 'managerId', header: t('manager'), render: (d) => (d.managerId ? empMap.get(d.managerId) : '-') },
        {
          key: 'isActive',
          header: tc('status'),
          render: (d) => <StatusBadge status={d.isActive ? 'active' : 'inactive'} label={d.isActive ? tc('active') : tc('inactive')} />,
        },
      ]}
    />
  );
}
