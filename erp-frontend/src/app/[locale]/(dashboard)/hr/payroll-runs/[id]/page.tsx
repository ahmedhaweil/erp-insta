'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import StatCard from '@/components/ui/StatCard';
import { Button, Card, Field, FormActions, Input, KeyValue, Select, SimpleTable, td, todayIso, useMoney } from '@/components/people/ui';
import { useBranches, useDepartments, useLabelMap, usePeopleMutation, usePeopleQuery } from '@/hooks/use-people';
import { hrService, type HrPaymentMethod } from '@/services/people-hr.service';
import { Banknote, Users, Landmark, Receipt, Download } from 'lucide-react';
import TreasuryPicker from '@/components/people/TreasuryPicker';
import { PrintButton } from '@/components/platform/PrintButton';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/hooks/use-people';
import { downloadFile } from '@/services/platform.service';

type Dialog = 'approve' | 'pay' | 'reverse' | 'cancel' | 'bankFile' | null;

export default function PayrollRunPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations('hr');
  const tc = useTranslations('common');
  const tp = useTranslations('people');
  const router = useRouter();
  const money = useMoney();
  const { data: run, isLoading } = usePeopleQuery(['hr-payroll-runs', id], () => hrService.run(id));
  const { data: branches } = useBranches();
  const { data: departments } = useDepartments();
  const branchMap = useLabelMap(branches, false);
  const deptMap = useLabelMap(departments, false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [date, setDate] = useState(todayIso());
  const [method, setMethod] = useState<HrPaymentMethod>('bank');
  const [treasuryId, setTreasuryId] = useState('');
  const [bankFile, setBankFile] = useState({ format: 'generic' as 'generic' | 'wps', bankName: '', valueDate: '' });
  const [downloading, setDownloading] = useState(false);
  const tpl = useTranslations('platform');

  const invalidate = ['hr-payroll-runs', 'hr-loans', 'hr-payroll-adjustments'];
  const close = { onSuccess: () => setDialog(null) };
  const recompute = usePeopleMutation(() => hrService.recomputeRun(id), { invalidate, success: t('runRecomputed') });
  const approve = usePeopleMutation((postingDate: string) => hrService.approveRun(id, postingDate || undefined), { invalidate, success: t('runApproved'), ...close });
  const pay = usePeopleMutation((body: { date: string; paymentMethod: HrPaymentMethod; treasuryId?: string }) => hrService.payRun(id, body), {
    invalidate: [...invalidate, 'people-treasuries'],
    success: t('runPaid'),
    ...close,
  });
  const downloadBankFile = async () => {
    setDownloading(true);
    try {
      await downloadFile(`/hr/payroll-runs/${id}/bank-file`, {
        format: bankFile.format,
        bankName: bankFile.bankName || undefined,
        valueDate: bankFile.valueDate || undefined,
        download: 'true',
      }, `payroll-${id}.csv`);
      setDialog(null);
    } catch (err) {
      toast.error(apiErrorMessage(err, tc('error')));
    } finally {
      setDownloading(false);
    }
  };
  const reverse = usePeopleMutation((d: string) => hrService.reverseRun(id, d || undefined), { invalidate, success: t('runReversed'), ...close });
  const cancel = usePeopleMutation(() => hrService.cancelRun(id), { invalidate, success: t('runCancelled'), ...close });

  if (isLoading || !run) return <div className="text-gray-500">{tc('loading')}</div>;

  const open = (d: Dialog, defaultDate = todayIso()) => {
    setDate(defaultDate);
    setTreasuryId('');
    setDialog(d);
  };

  return (
    <div className="space-y-6">
      <PageHeader title={`${t('payrollRun')} ${run.runNumber} - ${run.period}`} />
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={run.status === 'reversed' ? 'refunded' : run.status} label={t(`run_${run.status}`)} />
        <div className="flex-1" />
        {run.status === 'draft' && (
          <>
            <Button variant="secondary" onClick={() => recompute.mutate(undefined)} disabled={recompute.isPending}>
              {t('recompute')}
            </Button>
            <Button variant="success" onClick={() => open('approve', '')}>
              {t('approve')}
            </Button>
            <Button variant="danger" onClick={() => setDialog('cancel')}>
              {tc('cancel')}
            </Button>
          </>
        )}
        {run.status === 'approved' && (
          <Button variant="success" onClick={() => open('pay')}>
            {t('pay')}
          </Button>
        )}
        {(run.status === 'approved' || run.status === 'paid') && (
          <Button variant="danger" onClick={() => open('reverse', '')}>
            {t('reverse')}
          </Button>
        )}
        <Button variant="secondary" onClick={() => router.push(`/hr/payroll-runs/${id}/register`)}>
          {t('register')}
        </Button>
        <PrintButton size="md" path={`/print/payroll-runs/${id}/register`} label={tpl('print.register')} />
        <PrintButton size="md" path={`/print/payroll-runs/${id}/payslips`} label={tpl('print.allPayslips')} />
        {run.status !== 'draft' && run.status !== 'cancelled' && (
          <Button variant="secondary" onClick={() => setDialog('bankFile')}>
            <span className="inline-flex items-center gap-1.5">
              <Download size={14} /> {t('bankFile')}
            </span>
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard title={t('employeeCount')} value={run.employeeCount} icon={<Users size={22} />} />
        <StatCard title={t('gross')} value={money(run.totalGross)} icon={<Banknote size={22} />} color="green" />
        <StatCard title={t('totalDeductions')} value={money(Number(run.totalGross) - Number(run.totalNet))} icon={<Receipt size={22} />} color="red" />
        <StatCard title={t('net')} value={money(run.totalNet)} icon={<Landmark size={22} />} color="yellow" />
      </div>

      <Card>
        <KeyValue
          items={[
            { label: t('periodRange'), value: `${run.periodStart} → ${run.periodEnd}` },
            { label: t('branch'), value: run.branchId ? branchMap.get(run.branchId) : tp('allBranches') },
            { label: t('department'), value: run.departmentId ? deptMap.get(run.departmentId) : tp('allDepartments') },
            { label: t('employeeSi'), value: money(run.totalEmployeeSi) },
            { label: t('employerSi'), value: money(run.totalEmployerSi) },
            { label: t('incomeTax'), value: money(run.totalTax) },
            { label: t('loanDeductions'), value: money(run.totalLoans) },
            { label: t('otherDeductions'), value: money(run.totalOtherDeductions) },
            { label: t('postingDate'), value: run.postingDate ?? '-' },
            { label: t('paidDate'), value: run.paidDate ? `${run.paidDate} (${run.paymentMethod ? t(`method_${run.paymentMethod}`) : ''})` : '-' },
            { label: tc('notes'), value: run.notes || '-' },
          ]}
        />
      </Card>

      <SimpleTable
        headers={[tc('code'), tc('name'), t('basic'), t('allowancesShort'), t('overtime'), t('additions'), t('attendanceDeductions'), t('gross'), t('employeeSi'), t('incomeTax'), t('loanDeductions'), t('otherDeductions'), t('net'), '']}
      >
        {(run.lines ?? []).map((l) => (
          <tr key={l.id}>
            <td className={td}>{l.employeeCode}</td>
            <td className={td}>{l.employeeName}</td>
            <td className={td}>{money(l.basic)}</td>
            <td className={td}>{money(l.allowancesTotal)}</td>
            <td className={td}>{money(l.overtimePay)}</td>
            <td className={td}>{money(l.additionsTotal)}</td>
            <td className={td}>{money(l.attendanceDeductions)}</td>
            <td className={`${td} font-medium`}>{money(l.gross)}</td>
            <td className={td}>{money(l.employeeSi)}</td>
            <td className={td}>{money(l.incomeTax)}</td>
            <td className={td}>{money(l.loanDeduction)}</td>
            <td className={td}>{money(l.otherDeductions)}</td>
            <td className={`${td} font-semibold`}>{money(l.net)}</td>
            <td className={td}>
              <Link href={`/hr/payroll-runs/${id}/payslips/${l.employeeId}`} className="text-primary-600 hover:underline text-sm">
                {t('payslip')}
              </Link>
            </td>
          </tr>
        ))}
        {!run.lines?.length && (
          <tr>
            <td colSpan={14} className="p-8 text-center text-gray-500">
              {t('noLines')}
            </td>
          </tr>
        )}
      </SimpleTable>

      <Modal isOpen={dialog === 'approve'} onClose={() => setDialog(null)} title={t('approve')} size="sm">
        <form onSubmit={(e) => { e.preventDefault(); approve.mutate(date); }} className="space-y-4">
          <Field label={t('postingDate')} hint={t('postingDateHint')}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <FormActions onCancel={() => setDialog(null)} submitting={approve.isPending} submitLabel={t('approve')} />
        </form>
      </Modal>
      <Modal isOpen={dialog === 'pay'} onClose={() => setDialog(null)} title={t('pay')} size="sm">
        <form onSubmit={(e) => { e.preventDefault(); pay.mutate({ date, paymentMethod: method, treasuryId: treasuryId || undefined }); }} className="space-y-4">
          <Field label={tc('date')} required>
            <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={t('paymentMethod')} hint={t('paymentMethodHint')}>
            <Select value={method} onChange={(e) => setMethod(e.target.value as HrPaymentMethod)} options={['bank', 'cash'].map((v) => ({ value: v, label: t(`method_${v}`) }))} />
          </Field>
          <TreasuryPicker method={method} value={treasuryId} onChange={setTreasuryId} />
          <p className="text-sm">{t('net')}: <b>{money(run.totalNet)}</b></p>
          <FormActions onCancel={() => setDialog(null)} submitting={pay.isPending} submitLabel={t('pay')} />
        </form>
      </Modal>
      <Modal isOpen={dialog === 'reverse'} onClose={() => setDialog(null)} title={t('reverse')} size="sm">
        <form onSubmit={(e) => { e.preventDefault(); reverse.mutate(date); }} className="space-y-4">
          <Field label={t('reversalDate')} hint={t('reversalDateHint')}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <p className="text-sm text-red-700">{t('reverseWarning')}</p>
          <FormActions onCancel={() => setDialog(null)} submitting={reverse.isPending} submitLabel={t('reverse')} />
        </form>
      </Modal>
      <Modal isOpen={dialog === 'bankFile'} onClose={() => setDialog(null)} title={t('bankFile')} size="sm">
        <form onSubmit={(e) => { e.preventDefault(); downloadBankFile(); }} className="space-y-4">
          <Field label={t('bankFileFormat')}>
            <Select
              value={bankFile.format}
              onChange={(e) => setBankFile({ ...bankFile, format: e.target.value as 'generic' | 'wps' })}
              options={[
                { value: 'generic', label: t('bankFile_generic') },
                { value: 'wps', label: t('bankFile_wps') },
              ]}
            />
          </Field>
          <Field label={t('bankFileBank')} hint={t('bankFileBankHint')}>
            <Input value={bankFile.bankName} onChange={(e) => setBankFile({ ...bankFile, bankName: e.target.value })} />
          </Field>
          <Field label={t('bankFileValueDate')}>
            <Input type="date" value={bankFile.valueDate} onChange={(e) => setBankFile({ ...bankFile, valueDate: e.target.value })} />
          </Field>
          <FormActions onCancel={() => setDialog(null)} submitting={downloading} submitLabel={tc('download')} />
        </form>
      </Modal>
      <ConfirmDialog
        isOpen={dialog === 'cancel'}
        onClose={() => setDialog(null)}
        onConfirm={() => cancel.mutate(undefined)}
        title={tc('cancel')}
        message={t('cancelRunConfirm')}
        destructive
        loading={cancel.isPending}
      />
    </div>
  );
}
