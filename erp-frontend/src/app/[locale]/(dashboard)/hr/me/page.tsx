'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import DataTable from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import Modal from '@/components/ui/Modal';
import PrintStyles from '@/components/people/PrintStyles';
import { Button, Card, Field, FormActions, Input, KeyValue, LinkButton, Select, Tabs, todayIso, useMoney } from '@/components/people/ui';
import { apiErrorMessage, usePeopleMutation } from '@/hooks/use-people';
import { selfService, type LeaveRequest, type MyPayslipRow, type OvertimeRequest, type EmployeeLoan, type PayslipSummaryKey } from '@/services/people-hr.service';

type Tab = 'payslips' | 'leaves' | 'loans' | 'overtime';
const SUMMARY: PayslipSummaryKey[] = [
  'basic',
  'allowances',
  'overtime',
  'additions',
  'attendanceDeductions',
  'gross',
  'employeeSocialInsurance',
  'incomeTax',
  'loans',
  'otherDeductions',
  'totalDeductions',
  'net',
];
const SUMMARY_LABEL: Record<string, string> = {
  basic: 'reg_basic',
  allowances: 'reg_allowances',
  overtime: 'reg_overtime',
  additions: 'reg_additions',
  attendanceDeductions: 'reg_attendanceDeductions',
  gross: 'reg_gross',
  employeeSocialInsurance: 'reg_employeeSi',
  incomeTax: 'reg_incomeTax',
  loans: 'reg_loans',
  otherDeductions: 'reg_otherDeductions',
  totalDeductions: 'totalDeductions',
  net: 'reg_net',
};

/** Employee self-service: open to any logged-in user linked to an employee record. */
export default function SelfServicePage() {
  const t = useTranslations('hr');
  const ts = useTranslations('selfsvc');
  const tc = useTranslations('common');
  const locale = useLocale();
  const money = useMoney();
  const profile = useQuery({ queryKey: ['hr-me'], queryFn: selfService.profile, retry: false });
  const linked = !!profile.data;
  const [tab, setTab] = useState<Tab>('payslips');
  const year = new Date().getFullYear();
  const [balanceYear, setBalanceYear] = useState(year);

  const payslips = useQuery({ queryKey: ['hr-me', 'payslips'], queryFn: selfService.payslips, enabled: linked && tab === 'payslips' });
  const balances = useQuery({ queryKey: ['hr-me', 'balances', balanceYear], queryFn: () => selfService.balances(balanceYear), enabled: linked && tab === 'leaves' });
  const leaveTypes = useQuery({ queryKey: ['hr-me', 'leave-types'], queryFn: selfService.leaveTypes, enabled: linked });
  const leaves = useQuery({ queryKey: ['hr-me', 'leaves'], queryFn: selfService.leaveRequests, enabled: linked && tab === 'leaves' });
  const loans = useQuery({ queryKey: ['hr-me', 'loans'], queryFn: selfService.loans, enabled: linked && tab === 'loans' });
  const overtime = useQuery({ queryKey: ['hr-me', 'overtime'], queryFn: selfService.overtime, enabled: linked && tab === 'overtime' });

  const [slipRun, setSlipRun] = useState<MyPayslipRow | null>(null);
  const slip = useQuery({ queryKey: ['hr-me', 'payslip', slipRun?.runId], queryFn: () => selfService.payslip(slipRun!.runId), enabled: !!slipRun });

  const typeName = (id: string) => {
    const lt = leaveTypes.data?.find((x) => x.id === id);
    return lt ? (locale === 'ar' ? lt.nameAr || lt.name : lt.name) : '-';
  };

  // ---- leave request
  const [leaveOpen, setLeaveOpen] = useState(false);
  const emptyLeave = { leaveTypeId: '', startDate: todayIso(), endDate: todayIso(), reason: '', halfDay: false, halfDayPeriod: 'am' as 'am' | 'pm' };
  const [leave, setLeave] = useState(emptyLeave);
  const halfAllowed = !!leaveTypes.data?.find((x) => x.id === leave.leaveTypeId)?.allowHalfDay;
  const half = leave.halfDay && halfAllowed;
  const requestLeave = usePeopleMutation(
    () =>
      selfService.requestLeave({
        leaveTypeId: leave.leaveTypeId,
        startDate: leave.startDate,
        endDate: half ? leave.startDate : leave.endDate,
        reason: leave.reason,
        halfDay: half ? true : undefined,
        halfDayPeriod: half ? leave.halfDayPeriod : undefined,
      }),
    { invalidate: ['hr-me'], success: t('leaveRequested'), onSuccess: () => setLeaveOpen(false) },
  );
  const withdraw = usePeopleMutation((id: string) => selfService.cancelLeave(id), { invalidate: ['hr-me'], success: t('leaveCancelled') });

  // ---- overtime request
  const [otOpen, setOtOpen] = useState(false);
  const [ot, setOt] = useState({ date: todayIso(), hours: '', reason: '' });
  const requestOt = usePeopleMutation(() => selfService.requestOvertime({ date: ot.date, hours: Number(ot.hours), reason: ot.reason || undefined }), {
    invalidate: ['hr-me'],
    success: t('overtimeRequested'),
    onSuccess: () => setOtOpen(false),
  });

  if (profile.isLoading) return <div className="text-gray-500">{tc('loading')}</div>;
  if (!linked) {
    return (
      <div className="max-w-xl mx-auto mt-10 bg-white border border-gray-200 rounded-xl p-6 text-center space-y-2">
        <h1 className="text-xl font-bold">{ts('title')}</h1>
        <p className="text-sm text-gray-600">{ts('notLinked')}</p>
        {profile.error && <p className="text-xs text-gray-400">{apiErrorMessage(profile.error, '')}</p>}
      </div>
    );
  }
  const me = profile.data!;
  const myName = locale === 'ar' ? me.nameAr || me.nameEn : me.nameEn;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{ts('title')}</h1>
        <p className="text-sm text-gray-500">{ts('welcome', { name: myName })}</p>
      </div>
      <Card>
        <KeyValue
          items={[
            { label: ts('employeeCode'), value: me.code },
            { label: t('hireDate'), value: me.hireDate },
            { label: tc('email'), value: me.email || '-' },
            { label: tc('phone'), value: me.phone || '-' },
            { label: t('bankName'), value: me.bankName || '-' },
            { label: t('iban'), value: me.iban ? <span dir="ltr">{me.iban}</span> : '-' },
          ]}
        />
      </Card>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'payslips', label: ts('myPayslips') },
          { key: 'leaves', label: ts('myLeaves') },
          { key: 'loans', label: ts('myLoans') },
          { key: 'overtime', label: ts('myOvertime') },
        ]}
      />

      {tab === 'payslips' && (
        <DataTable<MyPayslipRow & { id: string }>
          data={(payslips.data ?? []).map((p) => ({ ...p, id: p.runId }))}
          loading={payslips.isLoading}
          onRowClick={(p) => setSlipRun(p)}
          columns={[
            { key: 'period', header: t('period') },
            { key: 'runNumber', header: t('runNumber') },
            { key: 'gross', header: t('gross'), render: (p) => money(p.gross) },
            { key: 'totalDeductions', header: t('totalDeductions'), render: (p) => money(p.totalDeductions) },
            { key: 'net', header: t('net'), render: (p) => <b>{money(p.net)}</b> },
            { key: 'status', header: tc('status'), render: (p) => <StatusBadge status={p.status} label={t(`run_${p.status}`)} /> },
          ]}
          actions={(p) => <LinkButton className="text-primary-600" onClick={() => setSlipRun(p)}>{t('payslip')}</LinkButton>}
        />
      )}

      {tab === 'leaves' && (
        <div className="space-y-4">
          <Card
            title={t('leaveBalances')}
            actions={
              <Input type="number" className="!w-28" value={balanceYear} onChange={(e) => setBalanceYear(Number(e.target.value) || year)} />
            }
          >
            {balances.isLoading ? (
              <p className="text-sm text-gray-500">{tc('loading')}</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {(balances.data ?? []).map((b) => (
                  <div key={b.leaveTypeId} className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500">{typeName(b.leaveTypeId) !== '-' ? typeName(b.leaveTypeId) : b.leaveTypeName}</p>
                    <p className="text-xl font-bold">{Number(b.remaining)}</p>
                    <p className="text-xs text-gray-500">
                      {ts('balanceLine', { entitlement: Number(b.entitlement), taken: Number(b.taken), pending: Number(b.pending) })}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <div className="flex justify-end">
            <Button
              onClick={() => {
                setLeave({ ...emptyLeave, leaveTypeId: leaveTypes.data?.[0]?.id ?? '' });
                setLeaveOpen(true);
              }}
            >
              {t('newLeaveRequest')}
            </Button>
          </div>
          <DataTable<LeaveRequest>
            data={leaves.data ?? []}
            loading={leaves.isLoading}
            columns={[
              { key: 'requestNumber', header: t('requestNumber') },
              { key: 'leaveTypeId', header: t('leaveType'), render: (r) => typeName(r.leaveTypeId) },
              { key: 'startDate', header: t('from') },
              { key: 'endDate', header: t('to') },
              { key: 'days', header: t('days'), render: (r) => (r.halfDay ? `${Number(r.days)} (${t(`halfDay_${r.halfDayPeriod ?? 'am'}`)})` : Number(r.days)) },
              { key: 'decisionNote', header: t('decisionNote'), render: (r) => r.decisionNote || '-' },
              { key: 'status', header: tc('status'), render: (r) => <StatusBadge status={r.status} label={t(`leave_${r.status}`)} /> },
            ]}
            actions={(r) =>
              r.status === 'draft' ? (
                <LinkButton className="text-red-600" disabled={withdraw.isPending} onClick={() => withdraw.mutate(r.id)}>
                  {ts('withdraw')}
                </LinkButton>
              ) : null
            }
          />
        </div>
      )}

      {tab === 'loans' && (
        <DataTable<EmployeeLoan>
          data={loans.data ?? []}
          loading={loans.isLoading}
          columns={[
            { key: 'loanNumber', header: t('loanNumber') },
            { key: 'type', header: t('loanType'), render: (l) => t(`loanType_${l.type}`) },
            { key: 'amount', header: tc('amount'), render: (l) => money(l.amount) },
            { key: 'repaidAmount', header: t('repaid'), render: (l) => money(l.repaidAmount) },
            { key: 'outstanding', header: t('outstanding'), render: (l) => money(Number(l.amount) - Number(l.repaidAmount)) },
            { key: 'installmentCount', header: t('installments') },
            { key: 'status', header: tc('status'), render: (l) => <StatusBadge status={l.status === 'disbursed' ? 'confirmed' : l.status === 'settled' ? 'paid' : l.status} label={t(`loan_${l.status}`)} /> },
          ]}
        />
      )}

      {tab === 'overtime' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button
              onClick={() => {
                setOt({ date: todayIso(), hours: '', reason: '' });
                setOtOpen(true);
              }}
            >
              {t('newOvertime')}
            </Button>
          </div>
          <DataTable<OvertimeRequest>
            data={overtime.data ?? []}
            loading={overtime.isLoading}
            columns={[
              { key: 'date', header: tc('date') },
              { key: 'hours', header: t('hours'), render: (r) => Number(r.hours) },
              { key: 'reason', header: t('reason'), render: (r) => r.reason || '-' },
              { key: 'decisionNote', header: t('decisionNote'), render: (r) => r.decisionNote || '-' },
              { key: 'status', header: tc('status'), render: (r) => <StatusBadge status={r.status} label={t(`leave_${r.status}`)} /> },
            ]}
          />
        </div>
      )}

      <Modal isOpen={!!slipRun} onClose={() => setSlipRun(null)} title={`${t('payslip')} ${slipRun?.period ?? ''}`} size="md">
        {slip.isLoading || !slip.data ? (
          <p className="text-sm text-gray-500">{slip.error ? apiErrorMessage(slip.error, tc('error')) : tc('loading')}</p>
        ) : (
          <div className="print-sheet">
            <PrintStyles />
            <p className="text-sm text-gray-600 mb-3">
              {myName} · {me.code} · {slip.data.run.periodStart} → {slip.data.run.periodEnd}
            </p>
            <table className="w-full text-sm">
              <tbody>
                {SUMMARY.filter((k) => k === 'gross' || k === 'net' || k === 'totalDeductions' || Number(slip.data!.summary[k] ?? 0) !== 0).map((k) => (
                  <tr key={k} className={['gross', 'net', 'totalDeductions'].includes(k) ? 'font-semibold border-t border-gray-200' : ''}>
                    <td className="py-1.5">{t(SUMMARY_LABEL[k])}</td>
                    <td className="py-1.5 text-end tabular-nums">{money(slip.data!.summary[k])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="no-print flex justify-end mt-4">
              <Button variant="secondary" onClick={() => window.print()}>
                {tc('print')}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={leaveOpen} onClose={() => setLeaveOpen(false)} title={t('newLeaveRequest')}>
        <form onSubmit={(e) => { e.preventDefault(); requestLeave.mutate(undefined); }} className="space-y-4">
          <Field label={t('leaveType')} required>
            <Select
              required
              value={leave.leaveTypeId}
              onChange={(e) => setLeave((l) => ({ ...l, leaveTypeId: e.target.value }))}
              options={(leaveTypes.data ?? []).map((lt) => ({ value: lt.id, label: locale === 'ar' ? lt.nameAr || lt.name : lt.name }))}
            />
          </Field>
          {halfAllowed && (
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={leave.halfDay} onChange={(e) => setLeave((l) => ({ ...l, halfDay: e.target.checked }))} />
                {t('halfDay')}
              </label>
              {leave.halfDay &&
                (['am', 'pm'] as const).map((p) => (
                  <label key={p} className="inline-flex items-center gap-1.5">
                    <input type="radio" checked={leave.halfDayPeriod === p} onChange={() => setLeave((l) => ({ ...l, halfDayPeriod: p }))} />
                    {t(`halfDay_${p}`)}
                  </label>
                ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <Field label={half ? tc('date') : t('from')} required>
              <Input type="date" required value={leave.startDate} onChange={(e) => setLeave((l) => ({ ...l, startDate: e.target.value }))} />
            </Field>
            {!half && (
              <Field label={t('to')} required>
                <Input type="date" required value={leave.endDate} onChange={(e) => setLeave((l) => ({ ...l, endDate: e.target.value }))} />
              </Field>
            )}
          </div>
          <Field label={t('reason')}>
            <Input value={leave.reason} onChange={(e) => setLeave((l) => ({ ...l, reason: e.target.value }))} />
          </Field>
          <p className="text-xs text-gray-500">{ts('leaveApprovalHint')}</p>
          <FormActions onCancel={() => setLeaveOpen(false)} submitting={requestLeave.isPending} />
        </form>
      </Modal>

      <Modal isOpen={otOpen} onClose={() => setOtOpen(false)} title={t('newOvertime')} size="sm">
        <form onSubmit={(e) => { e.preventDefault(); requestOt.mutate(undefined); }} className="space-y-4">
          <Field label={tc('date')} required>
            <Input type="date" required value={ot.date} onChange={(e) => setOt((o) => ({ ...o, date: e.target.value }))} />
          </Field>
          <Field label={t('hours')} required>
            <Input type="number" required min={0.25} max={24} step="0.25" value={ot.hours} onChange={(e) => setOt((o) => ({ ...o, hours: e.target.value }))} />
          </Field>
          <Field label={t('reason')}>
            <Input value={ot.reason} onChange={(e) => setOt((o) => ({ ...o, reason: e.target.value }))} />
          </Field>
          <FormActions onCancel={() => setOtOpen(false)} submitting={requestOt.isPending} />
        </form>
      </Modal>
    </div>
  );
}
