'use client';

import { useParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import PrintStyles from '@/components/people/PrintStyles';
import { Button, useMoney } from '@/components/people/ui';
import { useDepartments, useJobTitles, useLabelMap, usePeopleQuery } from '@/hooks/use-people';
import { hrService } from '@/services/people-hr.service';
import { PrintButton } from '@/components/platform/PrintButton';

/* eslint-disable @typescript-eslint/no-explicit-any */

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <tr className={strong ? 'font-semibold border-t border-gray-300' : undefined}>
      <td className="py-1.5 pe-4 text-gray-700">{label}</td>
      <td className="py-1.5 text-end tabular-nums">{value}</td>
    </tr>
  );
}

export default function PayslipPage() {
  const { id, employeeId } = useParams<{ id: string; employeeId: string }>();
  const t = useTranslations('hr');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const money = useMoney();
  const { data: slip, isLoading } = usePeopleQuery(['hr-payslip', id, employeeId], () => hrService.payslip(id, employeeId));
  // The server PDF is addressed by the payroll line id.
  const { data: run } = usePeopleQuery(['hr-payroll-runs', id], () => hrService.run(id));
  const lineId = (run as any)?.lines?.find((l: any) => l.employeeId === employeeId)?.id as string | undefined;
  const deptMap = useLabelMap(useDepartments().data, false);
  const jobMap = useLabelMap(useJobTitles().data, false);

  if (isLoading || !slip) return <div className="text-gray-500">{tc('loading')}</div>;
  const s = slip.summary;
  const b = slip.breakdown ?? {};
  const allowances: { code: string; name: string; amount: number }[] = b.earnings?.allowances ?? [];
  const additions: { description: string; amount: number }[] = b.earnings?.additions ?? [];
  const deductions: { description: string; amount: number }[] = b.otherDeductions ?? [];
  const att = b.attendance ?? {};
  const ad = b.attendanceDeductions ?? {};
  const si = b.socialInsurance ?? {};
  const pct = (v: number) => `${Math.round(Number(v || 0) * 10000) / 100}%`;
  const empName = locale === 'ar' ? slip.employee.nameAr || slip.employee.nameEn : slip.employee.nameEn;

  return (
    <div>
      <PrintStyles />
      <div className="no-print flex gap-3 mb-4">
        <Button variant="secondary" onClick={() => router.push(`/hr/payroll-runs/${id}`)}>
          {tc('back')}
        </Button>
        {lineId ? (
          <PrintButton size="md" variant="secondary" path={`/print/payroll-lines/${lineId}/payslip`} label={tc('print')} className="!bg-primary-600 !text-white hover:!bg-primary-700" />
        ) : (
          <Button onClick={() => window.print()}>{tc('print')}</Button>
        )}
      </div>

      <div className="print-sheet bg-white border border-gray-200 rounded-xl p-8 max-w-3xl mx-auto text-sm">
        <div className="flex justify-between items-start border-b border-gray-300 pb-4 mb-4">
          <div>
            <h1 className="text-xl font-bold">{t('payslip')}</h1>
            <p className="text-gray-600">
              {t('period')}: {slip.run.period} ({slip.run.periodStart} → {slip.run.periodEnd})
            </p>
          </div>
          <div className="text-end text-gray-600">
            <div>{slip.run.runNumber}</div>
            <div>{t(`run_${slip.run.status}`)}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-1 mb-6">
          <div><span className="text-gray-500">{t('employee')}: </span><b>{slip.employee.code} - {empName}</b></div>
          <div><span className="text-gray-500">{t('nationalId')}: </span>{slip.employee.nationalId || '-'}</div>
          <div><span className="text-gray-500">{t('department')}: </span>{slip.employee.departmentId ? deptMap.get(slip.employee.departmentId) : '-'}</div>
          <div><span className="text-gray-500">{t('jobTitle')}: </span>{slip.employee.jobTitleId ? jobMap.get(slip.employee.jobTitleId) : '-'}</div>
          <div><span className="text-gray-500">{t('socialInsuranceNumber')}: </span>{slip.employee.socialInsuranceNumber || '-'}</div>
          <div><span className="text-gray-500">{t('bank')}: </span>{[slip.employee.bankName, slip.employee.iban].filter(Boolean).join(' - ') || '-'}</div>
        </div>

        <div className="grid grid-cols-2 gap-8">
          <div>
            <h2 className="font-semibold border-b border-gray-300 pb-1 mb-1">{t('earnings')}</h2>
            <table className="w-full">
              <tbody>
                <Row label={t('basic')} value={money(s.basic)} />
                {allowances.map((a) => (
                  <Row key={a.code} label={a.name || a.code} value={money(a.amount)} />
                ))}
                {s.overtime > 0 && <Row label={`${t('overtime')} (${att.overtimeHours ?? 0} ${t('hoursShort')})`} value={money(s.overtime)} />}
                {additions.map((a, i) => (
                  <Row key={i} label={a.description} value={money(a.amount)} />
                ))}
                {s.attendanceDeductions > 0 && <Row label={t('attendanceDeductions')} value={`-${money(s.attendanceDeductions)}`} />}
                <Row strong label={t('gross')} value={money(s.gross)} />
              </tbody>
            </table>
          </div>
          <div>
            <h2 className="font-semibold border-b border-gray-300 pb-1 mb-1">{t('deductions')}</h2>
            <table className="w-full">
              <tbody>
                <Row label={`${t('employeeSi')} (${pct(si.employeeRate)} × ${money(si.wage)})`} value={money(s.employeeSocialInsurance)} />
                <Row label={t('incomeTax')} value={money(s.incomeTax)} />
                {s.loans > 0 && <Row label={t('loanDeductions')} value={money(s.loans)} />}
                {deductions.map((d, i) => (
                  <Row key={i} label={d.description} value={money(d.amount)} />
                ))}
                <Row strong label={t('totalDeductions')} value={money(s.totalDeductions)} />
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 p-4 bg-gray-50 border border-gray-300 rounded-lg flex justify-between text-lg font-bold">
          <span>{t('netPay')}</span>
          <span className="tabular-nums">{money(s.net)}</span>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-8 text-xs text-gray-600">
          <div>
            <h3 className="font-semibold text-gray-800 mb-1">{t('attendance')}</h3>
            <div>{t('workingDays')}: {att.workingDays ?? '-'} | {t('presentDays')}: {att.presentDays ?? '-'}</div>
            <div>{t('absenceDays')}: {att.absenceDays ?? 0} ({money(ad.absence)}) | {t('unpaidLeaveDays')}: {att.unpaidLeaveDays ?? 0} ({money(ad.unpaidLeave)})</div>
            <div>{t('lateMinutes')}: {att.lateMinutes ?? 0} ({money(ad.late)}) | {t('paidLeaveDays')}: {att.paidLeaveDays ?? 0}</div>
          </div>
          <div>
            <h3 className="font-semibold text-gray-800 mb-1">{t('employerContributions')}</h3>
            <div>{t('employerSi')} ({pct(si.employerRate)}): {money(s.employerSocialInsurance)}</div>
            <div>{t('annualTaxable')}: {money(b.incomeTax?.annualTaxable)}</div>
          </div>
        </div>

        <div className="mt-12 grid grid-cols-2 gap-8 text-xs text-gray-600">
          <div className="border-t border-gray-400 pt-1">{t('employeeSignature')}</div>
          <div className="border-t border-gray-400 pt-1">{t('hrSignature')}</div>
        </div>
      </div>
    </div>
  );
}
