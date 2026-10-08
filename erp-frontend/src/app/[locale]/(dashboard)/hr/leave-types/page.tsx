'use client';

import { useTranslations } from 'next-intl';
import SimpleCrud from '@/components/people/SimpleCrud';
import StatusBadge from '@/components/ui/StatusBadge';
import { hrService, type LeaveType } from '@/services/people-hr.service';
import { useLocalName } from '@/hooks/use-people';

export default function LeaveTypesPage() {
  const t = useTranslations('hr');
  const tc = useTranslations('common');
  const name = useLocalName();

  return (
    <SimpleCrud<LeaveType>
      title={t('leaveTypes')}
      newLabel={t('newLeaveType')}
      queryKey="hr-leave-types"
      load={hrService.leaveTypes}
      create={hrService.createLeaveType}
      update={hrService.updateLeaveType}
      fields={[
        { name: 'code', label: tc('code'), required: true },
        { name: 'name', label: t('nameEn'), required: true },
        { name: 'nameAr', label: t('nameAr') },
        { name: 'annualEntitlement', label: t('annualEntitlement'), type: 'number', defaultValue: 0 },
        { name: 'seniorEntitlement', label: t('seniorEntitlement'), type: 'number' },
        { name: 'seniorAfterYears', label: t('seniorAfterYears'), type: 'number', step: '1' },
        { name: 'isPaid', label: t('isPaid'), type: 'checkbox', defaultValue: true },
        { name: 'allowNegative', label: t('allowNegative'), type: 'checkbox' },
        {
          name: 'accrualMethod',
          label: t('accrualMethod'),
          type: 'select',
          defaultValue: 'annual',
          options: [
            { value: 'annual', label: t('accrual_annual') },
            { value: 'monthly', label: t('accrual_monthly') },
          ],
        },
        { name: 'carryForward', label: t('carryForward'), type: 'checkbox' },
        { name: 'carryForwardMax', label: t('carryForwardMax'), type: 'number' },
        { name: 'carryForwardExpiryMonths', label: t('carryForwardExpiryMonths'), type: 'number', step: '1' },
        { name: 'allowHalfDay', label: t('allowHalfDay'), type: 'checkbox' },
        { name: 'encashable', label: t('encashable'), type: 'checkbox' },
        { name: 'isActive', label: tc('active'), type: 'checkbox', defaultValue: true },
      ]}
      columns={[
        { key: 'code', header: tc('code') },
        { key: 'name', header: tc('name'), render: (l) => name(l) },
        { key: 'isPaid', header: t('isPaid'), render: (l) => (l.isPaid ? tc('yes') : tc('no')) },
        { key: 'annualEntitlement', header: t('annualEntitlement'), render: (l) => Number(l.annualEntitlement) },
        {
          key: 'seniorEntitlement',
          header: t('seniorEntitlement'),
          render: (l) => (l.seniorEntitlement != null ? t('seniorRule', { days: Number(l.seniorEntitlement), years: l.seniorAfterYears ?? 0 }) : '-'),
        },
        { key: 'accrualMethod', header: t('accrualMethod'), render: (l) => t(`accrual_${l.accrualMethod ?? 'annual'}`) },
        {
          key: 'carryForward',
          header: t('carryForward'),
          render: (l) =>
            l.carryForward
              ? t('carryForwardRule', { max: l.carryForwardMax != null ? Number(l.carryForwardMax) : '∞', months: l.carryForwardExpiryMonths ?? '∞' })
              : tc('no'),
        },
        {
          key: 'flags',
          header: t('leaveOptions'),
          render: (l) => [l.allowHalfDay ? t('allowHalfDay') : '', l.encashable ? t('encashable') : ''].filter(Boolean).join('، ') || '-',
        },
        {
          key: 'isActive',
          header: tc('status'),
          render: (l) => <StatusBadge status={l.isActive ? 'active' : 'inactive'} label={l.isActive ? tc('active') : tc('inactive')} />,
        },
      ]}
    />
  );
}
