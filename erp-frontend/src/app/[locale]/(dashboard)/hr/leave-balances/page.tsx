'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import { Field, Input, SimpleTable, Toolbar, td } from '@/components/people/ui';
import { useLabelMap, useDepartments, useLeaveTypes, useLocalName, usePeopleQuery } from '@/hooks/use-people';
import { hrService } from '@/services/people-hr.service';

export default function LeaveBalancesPage() {
  const t = useTranslations('hr');
  const tc = useTranslations('common');
  const tp = useTranslations('people');
  const locale = useLocale();
  const name = useLocalName();
  const [year, setYear] = useState(new Date().getFullYear());
  const { data, isLoading } = usePeopleQuery(['hr-leave-balances', 'report', year], () => hrService.balancesReport(year));
  const { data: types = [] } = useLeaveTypes();
  const { data: departments } = useDepartments();
  const deptMap = useLabelMap(departments, false);
  const activeTypes = types.filter((ty) => ty.isActive);

  return (
    <div>
      <PageHeader title={t('leaveBalances')} />
      <Toolbar>
        <Field label={tp('year')}>
          <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-32" />
        </Field>
        <p className="text-xs text-gray-500">{t('balanceLegend')}</p>
      </Toolbar>
      {isLoading ? (
        <div className="text-gray-500">{tc('loading')}</div>
      ) : (
        <SimpleTable headers={[tc('code'), tc('name'), t('department'), ...activeTypes.map((ty) => name(ty))]}>
          {(data?.rows ?? []).map((row) => (
            <tr key={row.employeeId}>
              <td className={td}>{row.employeeCode}</td>
              <td className={td}>{locale === 'ar' ? row.employeeNameAr || row.employeeName : row.employeeName}</td>
              <td className={td}>{row.departmentId ? deptMap.get(row.departmentId) : '-'}</td>
              {activeTypes.map((ty) => {
                const b = row.balances.find((x) => x.leaveTypeId === ty.id);
                if (!b) return <td key={ty.id} className={td}>-</td>;
                return (
                  <td key={ty.id} className={td} title={`${t('taken')}: ${b.taken} / ${t('pending')}: ${b.pending}`}>
                    <span className={b.remaining < 0 ? 'text-red-600 font-semibold' : 'font-semibold'}>{b.remaining}</span>
                    <span className="text-gray-400"> / {b.entitlement}</span>
                    {b.pending > 0 && <span className="text-amber-600 text-xs ms-1">(+{b.pending})</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </SimpleTable>
      )}
    </div>
  );
}
