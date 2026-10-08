'use client';

import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import PrintStyles from '@/components/people/PrintStyles';
import { Button, SimpleTable, td, useMoney } from '@/components/people/ui';
import { usePeopleQuery } from '@/hooks/use-people';
import { REGISTER_KEYS, hrService } from '@/services/people-hr.service';

export default function PayrollRegisterPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations('hr');
  const tc = useTranslations('common');
  const router = useRouter();
  const money = useMoney();
  const { data, isLoading } = usePeopleQuery(['hr-payroll-runs', id, 'register'], () => hrService.register(id));

  if (isLoading || !data) return <div className="text-gray-500">{tc('loading')}</div>;

  return (
    <div>
      <PrintStyles />
      <div className="no-print flex gap-3 mb-4">
        <Button variant="secondary" onClick={() => router.push(`/hr/payroll-runs/${id}`)}>
          {tc('back')}
        </Button>
        <Button onClick={() => window.print()}>{tc('print')}</Button>
      </div>
      <div className="print-sheet">
        <h1 className="text-xl font-bold mb-1">{t('register')}</h1>
        <p className="text-sm text-gray-600 mb-4">
          {data.run.runNumber} | {t('period')}: {data.run.period} | {t(`run_${data.run.status}`)}
        </p>
        <SimpleTable
          headers={[tc('code'), tc('name'), ...REGISTER_KEYS.map((k) => t(`reg_${k}`))]}
          footer={
            <tr>
              <td className={td} colSpan={2}>{tc('total')}</td>
              {REGISTER_KEYS.map((k) => (
                <td key={k} className={td}>{money(data.totals[k])}</td>
              ))}
            </tr>
          }
        >
          {data.lines.map((l) => (
            <tr key={l.employeeId}>
              <td className={td}>{l.employeeCode}</td>
              <td className={td}>{l.employeeName}</td>
              {REGISTER_KEYS.map((k) => (
                <td key={k} className={`${td} tabular-nums`}>{money(l[k])}</td>
              ))}
            </tr>
          ))}
        </SimpleTable>
      </div>
    </div>
  );
}
