'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import Modal from '@/components/ui/Modal';
import { Field, FormActions, Input, KeyValue, LinkButton, Select, SimpleTable, Toolbar, currentPeriod, td, todayIso, useMoney } from '@/components/people/ui';
import { useEmployeesLookup, useLabelMap, usePeopleMutation, usePeopleQuery } from '@/hooks/use-people';
import { hrService, type EmployeeLoan, type HrPaymentMethod } from '@/services/people-hr.service';

const STATUSES = ['draft', 'disbursed', 'settled', 'cancelled'];
const LOAN_COLORS: Record<string, string> = { disbursed: 'confirmed', settled: 'paid', draft: 'draft', cancelled: 'cancelled' };

export default function LoansPage() {
  const t = useTranslations('hr');
  const tc = useTranslations('common');
  const tp = useTranslations('people');
  const money = useMoney();
  const [filters, setFilters] = useState({ status: '', employeeId: '' });
  const { data = [], isLoading } = usePeopleQuery(['hr-loans', filters], () => hrService.loans(filters));
  const { data: employees } = useEmployeesLookup();
  const empMap = useLabelMap(employees);
  const activeOptions = [...useLabelMap(employees?.filter((e) => e.status === 'active'))].map(([value, label]) => ({ value, label }));
  const [open, setOpen] = useState(false);
  const blank = { employeeId: '', type: 'loan', amount: '', installmentCount: '1', startPeriod: currentPeriod(), notes: '' };
  const [form, setForm] = useState(blank);
  const [viewId, setViewId] = useState<string | null>(null);
  const { data: loan } = usePeopleQuery(['hr-loans', 'detail', viewId], () => hrService.loan(viewId!), !!viewId);
  const [disbursing, setDisbursing] = useState<EmployeeLoan | null>(null);
  const [disburse, setDisburse] = useState<{ date: string; paymentMethod: HrPaymentMethod }>({ date: todayIso(), paymentMethod: 'cash' });

  const create = usePeopleMutation(
    (body: typeof blank) => hrService.createLoan({ ...body, amount: Number(body.amount), installmentCount: Number(body.installmentCount) }),
    { invalidate: ['hr-loans'], success: t('loanCreated'), onSuccess: () => setOpen(false) },
  );
  const doDisburse = usePeopleMutation(
    (input: { id: string; date: string; paymentMethod: HrPaymentMethod }) => hrService.disburseLoan(input.id, { date: input.date, paymentMethod: input.paymentMethod }),
    { invalidate: ['hr-loans'], success: t('loanDisbursed'), onSuccess: (res) => { setDisbursing(null); setViewId(res.id); } },
  );
  const cancel = usePeopleMutation((id: string) => hrService.cancelLoan(id), { invalidate: ['hr-loans'], success: t('loanCancelled') });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(form);
  };
  const installment = Number(form.amount || 0) / Math.max(Number(form.installmentCount || 1), 1);

  return (
    <div>
      <PageHeader title={t('loans')} action={{ label: t('newLoan'), onClick: () => { setForm(blank); setOpen(true); } }} />
      <Toolbar>
        <Field label={tc('status')}>
          <Select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} placeholder={tc('all')} options={STATUSES.map((s) => ({ value: s, label: t(`loan_${s}`) }))} />
        </Field>
        <Field label={t('employee')}>
          <Select value={filters.employeeId} onChange={(e) => setFilters((f) => ({ ...f, employeeId: e.target.value }))} placeholder={tc('all')} options={[...empMap].map(([value, label]) => ({ value, label }))} />
        </Field>
      </Toolbar>
      <DataTable<EmployeeLoan>
        data={data}
        loading={isLoading}
        onRowClick={(l) => setViewId(l.id)}
        columns={[
          { key: 'loanNumber', header: t('loanNumber') },
          { key: 'employeeId', header: t('employee'), render: (l) => empMap.get(l.employeeId) ?? '-' },
          { key: 'type', header: t('loanType'), render: (l) => t(`loanType_${l.type}`) },
          { key: 'amount', header: tc('amount'), render: (l) => money(l.amount) },
          { key: 'installmentCount', header: t('installments') },
          { key: 'startPeriod', header: t('startPeriod') },
          { key: 'repaidAmount', header: t('repaid'), render: (l) => money(l.repaidAmount) },
          { key: 'status', header: tc('status'), render: (l) => <StatusBadge status={LOAN_COLORS[l.status]} label={t(`loan_${l.status}`)} /> },
        ]}
        actions={(l) => (
          <div className="flex gap-3">
            {l.status === 'draft' && (
              <>
                <LinkButton className="text-green-600" onClick={() => { setDisburse({ date: todayIso(), paymentMethod: 'cash' }); setDisbursing(l); }}>
                  {t('disburse')}
                </LinkButton>
                <LinkButton className="text-red-600" disabled={cancel.isPending} onClick={() => cancel.mutate(l.id)}>
                  {tc('cancel')}
                </LinkButton>
              </>
            )}
            <LinkButton className="text-primary-600" onClick={() => setViewId(l.id)}>
              {t('installments')}
            </LinkButton>
          </div>
        )}
      />

      <Modal isOpen={open} onClose={() => setOpen(false)} title={t('newLoan')}>
        <form onSubmit={submit} className="space-y-4">
          <Field label={t('employee')} required>
            <Select required value={form.employeeId} onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))} placeholder={tp('select')} options={activeOptions} />
          </Field>
          <Field label={t('loanType')}>
            <Select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} options={['loan', 'advance'].map((v) => ({ value: v, label: t(`loanType_${v}`) }))} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label={tc('amount')} required>
              <Input type="number" step="any" min="0.01" required value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
            </Field>
            <Field label={t('installments')} required>
              <Input type="number" min={1} max={120} required value={form.installmentCount} onChange={(e) => setForm((f) => ({ ...f, installmentCount: e.target.value }))} />
            </Field>
          </div>
          <Field label={t('startPeriod')} required hint={t('startPeriodHint')}>
            <Input type="month" required value={form.startPeriod} onChange={(e) => setForm((f) => ({ ...f, startPeriod: e.target.value }))} />
          </Field>
          <Field label={tc('notes')}>
            <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </Field>
          <p className="text-sm text-gray-600">
            {t('installmentAmount')}: <b>{money(installment)}</b>
          </p>
          <FormActions onCancel={() => setOpen(false)} submitting={create.isPending} />
        </form>
      </Modal>

      <Modal isOpen={!!disbursing} onClose={() => setDisbursing(null)} title={`${t('disburse')}: ${disbursing?.loanNumber ?? ''}`} size="sm">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (disbursing) doDisburse.mutate({ id: disbursing.id, ...disburse });
          }}
          className="space-y-4"
        >
          <Field label={tc('date')} required>
            <Input type="date" required value={disburse.date} onChange={(e) => setDisburse((d) => ({ ...d, date: e.target.value }))} />
          </Field>
          <Field label={t('paymentMethod')} required>
            <Select value={disburse.paymentMethod} onChange={(e) => setDisburse((d) => ({ ...d, paymentMethod: e.target.value as HrPaymentMethod }))} options={['cash', 'bank'].map((v) => ({ value: v, label: t(`method_${v}`) }))} />
          </Field>
          <p className="text-xs text-gray-500">{t('disburseHint')}</p>
          <FormActions onCancel={() => setDisbursing(null)} submitting={doDisburse.isPending} submitLabel={t('disburse')} />
        </form>
      </Modal>

      <Modal isOpen={!!viewId} onClose={() => setViewId(null)} title={loan ? `${loan.loanNumber} - ${empMap.get(loan.employeeId) ?? ''}` : tc('loading')} size="lg">
        {loan && (
          <div className="space-y-4">
            <KeyValue
              items={[
                { label: tc('amount'), value: money(loan.amount) },
                { label: t('repaid'), value: money(loan.repaidAmount) },
                { label: t('outstanding'), value: money(Number(loan.amount) - Number(loan.repaidAmount)) },
                { label: tc('status'), value: t(`loan_${loan.status}`) },
                { label: t('disbursementDate'), value: loan.disbursementDate ?? '-' },
                { label: t('paymentMethod'), value: loan.paymentMethod ? t(`method_${loan.paymentMethod}`) : '-' },
              ]}
            />
            {loan.installments?.length ? (
              <SimpleTable headers={['#', t('duePeriod'), tc('amount'), tc('paid'), t('outstanding')]}>
                {loan.installments.map((i) => (
                  <tr key={i.id}>
                    <td className={td}>{i.sequence}</td>
                    <td className={td}>{i.duePeriod}</td>
                    <td className={td}>{money(i.amount)}</td>
                    <td className={td}>{money(i.paidAmount)}</td>
                    <td className={td}>{money(Number(i.amount) - Number(i.paidAmount))}</td>
                  </tr>
                ))}
              </SimpleTable>
            ) : (
              <p className="text-sm text-gray-500">{t('noInstallmentsYet')}</p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
