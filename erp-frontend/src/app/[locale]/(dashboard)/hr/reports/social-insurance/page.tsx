'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import PrintStyles from '@/components/people/PrintStyles';
import { Button, Card, Field, Input, SimpleTable, Toolbar, currentPeriod, td, useMoney } from '@/components/people/ui';
import { usePeopleQuery } from '@/hooks/use-people';
import { hrService } from '@/services/people-hr.service';

export default function SocialInsuranceReportPage() {
  const t = useTranslations('hr');
  const tc = useTranslations('common');
  const money = useMoney();
  const [period, setPeriod] = useState(currentPeriod());
  const { data, isLoading } = usePeopleQuery(['hr-si-report', period], () => hrService.socialInsurance(period), /^\d{4}-\d{2}$/.test(period));

  return (
    <div>
      <PrintStyles />
      <PageHeader title={t('socialInsuranceReport')} />
      <div className="no-print">
        <Toolbar>
          <Field label={t('period')}>
            <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </Field>
          <Button variant="secondary" onClick={() => window.print()}>
            {tc('print')}
          </Button>
        </Toolbar>
      </div>
      {isLoading || !data ? (
        <div className="text-gray-500">{tc('loading')}</div>
      ) : (
        <div className="print-sheet space-y-4">
          <p className="text-sm text-gray-600">
            {t('period')}: {data.period} | {t('includedRuns')}: {data.runs.join(', ') || '-'}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.totals.map((tot) => (
              <Card key={tot.country} title={t(`country_${tot.country}`)}>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <span className="text-gray-500">{t('employeeCount')}</span><span>{tot.employees}</span>
                  <span className="text-gray-500">{t('insurableWage')}</span><span>{money(tot.insurableWage)}</span>
                  <span className="text-gray-500">{t('employeeShare')}</span><span>{money(tot.employeeShare)}</span>
                  <span className="text-gray-500">{t('employerShare')}</span><span>{money(tot.employerShare)}</span>
                  <span className="text-gray-500 font-semibold">{tc('total')}</span><span className="font-semibold">{money(tot.total)}</span>
                </div>
              </Card>
            ))}
          </div>
          <SimpleTable headers={[tc('code'), tc('name'), t('nationalId'), t('nationality'), t('socialInsuranceNumber'), t('payrollCountry'), t('insurableWage'), t('employeeShare'), t('employerShare'), tc('total')]}>
            {data.rows.map((r) => (
              <tr key={r.employeeId}>
                <td className={td}>{r.employeeCode}</td>
                <td className={td}>{r.employeeName}</td>
                <td className={td}>{r.nationalId ?? '-'}</td>
                <td className={td}>{r.nationality ?? '-'}</td>
                <td className={td}>{r.socialInsuranceNumber ?? '-'}</td>
                <td className={td}>{r.payrollCountry}</td>
                <td className={td}>{money(r.insurableWage)}</td>
                <td className={td}>{money(r.employeeShare)}</td>
                <td className={td}>{money(r.employerShare)}</td>
                <td className={td}>{money(r.total)}</td>
              </tr>
            ))}
            {!data.rows.length && (
              <tr>
                <td colSpan={10} className="p-8 text-center text-gray-500">{t('noApprovedRuns')}</td>
              </tr>
            )}
          </SimpleTable>
        </div>
      )}
    </div>
  );
}
