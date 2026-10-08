'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import Modal from '@/components/ui/Modal';
import TreasuryPicker from '@/components/people/TreasuryPicker';
import { Button, Checkbox, Field, FormActions, Input, KeyValue, LinkButton, Select, Toolbar, todayIso, useMoney } from '@/components/people/ui';
import { useEmployeesLookup, useLabelMap, usePeopleMutation, usePeopleQuery } from '@/hooks/use-people';
import { hrService, SETTLEMENT_REASONS, type FinalSettlement, type HrPaymentMethod, type SettlementReason } from '@/services/people-hr.service';

type Item = { description: string; amount: string };
const STATUS_COLORS: Record<string, string> = { draft: 'draft', posted: 'posted', paid: 'paid', cancelled: 'cancelled' };

/** Final settlement (مخالصة نهائية) of a terminated employee: gratuity, leave, last salary, loans. */
export default function FinalSettlementsPage() {
  const t = useTranslations('hr');
  const tc = useTranslations('common');
  const tp = useTranslations('people');
  const money = useMoney();
  const [status, setStatus] = useState('');
  const { data = [], isLoading } = usePeopleQuery(['hr-final-settlements', status], () => hrService.settlements({ status }));
  const { data: employees } = useEmployeesLookup();
  const empMap = useLabelMap(employees);
  const terminated = [...useLabelMap(employees?.filter((e) => e.status === 'terminated'))].map(([value, label]) => ({ value, label }));

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ employeeId: '', reason: 'termination' as SettlementReason, lastSalary: '', encashLeave: true, notes: '' });
  const [additions, setAdditions] = useState<Item[]>([]);
  const [deductions, setDeductions] = useState<Item[]>([]);
  const [viewId, setViewId] = useState<string | null>(null);
  const [action, setAction] = useState<'post' | 'pay' | 'cancel' | null>(null);
  const [actionForm, setActionForm] = useState({ date: todayIso(), method: 'bank' as HrPaymentMethod, treasuryId: '' });
  const { data: detail } = usePeopleQuery(['hr-final-settlements', 'one', viewId], () => hrService.settlement(viewId!), !!viewId);

  const items = (list: Item[]) => list.filter((i) => i.description.trim() && Number(i.amount) > 0).map((i) => ({ description: i.description.trim(), amount: Number(i.amount) }));
  const invalidate = ['hr-final-settlements', 'hr-loans', 'hr-eos-provisions', 'people-treasuries'];
  const create = usePeopleMutation(
    () =>
      hrService.createSettlement({
        employeeId: form.employeeId,
        reason: form.reason,
        lastSalary: form.lastSalary !== '' ? Number(form.lastSalary) : undefined,
        encashLeave: form.encashLeave,
        additions: items(additions),
        deductions: items(deductions),
        notes: form.notes || undefined,
      }),
    {
      invalidate,
      success: t('settlementCreated'),
      onSuccess: (s) => {
        setOpen(false);
        setViewId(s.id);
      },
    },
  );
  const act = usePeopleMutation(
    () => {
      const id = viewId!;
      if (action === 'post') return hrService.postSettlement(id, actionForm.date || undefined);
      if (action === 'pay')
        return hrService.paySettlement(id, { date: actionForm.date, paymentMethod: actionForm.method, treasuryId: actionForm.treasuryId || undefined });
      return hrService.cancelSettlement(id, actionForm.date || undefined);
    },
    { invalidate, onSuccess: () => setAction(null) },
  );

  const startAction = (a: 'post' | 'pay' | 'cancel') => {
    setActionForm({ date: a === 'pay' ? todayIso() : '', method: 'bank', treasuryId: '' });
    setAction(a);
  };

  const itemEditor = (label: string, list: Item[], setList: (l: Item[]) => void) => (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        <LinkButton className="text-primary-600 inline-flex items-center gap-1" onClick={() => setList([...list, { description: '', amount: '' }])}>
          <Plus size={14} /> {tc('create')}
        </LinkButton>
      </div>
      {list.map((it, i) => (
        <div key={i} className="flex gap-2 mb-2">
          <Input placeholder={tc('description')} value={it.description} onChange={(e) => setList(list.map((x, idx) => (idx === i ? { ...x, description: e.target.value } : x)))} />
          <Input type="number" min={0} step="any" className="!w-32" placeholder={tc('amount')} value={it.amount} onChange={(e) => setList(list.map((x, idx) => (idx === i ? { ...x, amount: e.target.value } : x)))} />
          <button type="button" className="p-2 text-gray-400 hover:text-red-600" onClick={() => setList(list.filter((_, idx) => idx !== i))} aria-label={tc('delete')}>
            <Trash2 size={16} />
          </button>
        </div>
      ))}
    </div>
  );

  const d = detail;
  return (
    <div>
      <PageHeader
        title={t('finalSettlements')}
        action={{
          label: t('newSettlement'),
          onClick: () => {
            setForm({ employeeId: '', reason: 'termination', lastSalary: '', encashLeave: true, notes: '' });
            setAdditions([]);
            setDeductions([]);
            setOpen(true);
          },
        }}
      />
      <Toolbar>
        <Field label={tc('status')}>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} placeholder={tc('all')} options={['draft', 'posted', 'paid', 'cancelled'].map((s) => ({ value: s, label: t(`settlement_${s}`) }))} />
        </Field>
      </Toolbar>
      <DataTable<FinalSettlement>
        data={data}
        loading={isLoading}
        onRowClick={(s) => setViewId(s.id)}
        columns={[
          { key: 'settlementNumber', header: t('number') },
          { key: 'employeeId', header: t('employee'), render: (s) => empMap.get(s.employeeId) ?? '-' },
          { key: 'terminationDate', header: t('terminationDate') },
          { key: 'reason', header: t('reason'), render: (s) => t(`reason_${s.reason}`) },
          { key: 'gratuity', header: t('gratuityAmount'), render: (s) => money(s.gratuity) },
          { key: 'net', header: t('net'), render: (s) => money(s.net) },
          { key: 'status', header: tc('status'), render: (s) => <StatusBadge status={STATUS_COLORS[s.status]} label={t(`settlement_${s.status}`)} /> },
        ]}
      />

      <Modal isOpen={open} onClose={() => setOpen(false)} title={t('newSettlement')} size="lg">
        <form onSubmit={(e) => { e.preventDefault(); create.mutate(undefined); }} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label={t('employee')} required hint={terminated.length ? t('settlementEmployeeHint') : t('noTerminatedEmployees')}>
              <Select required value={form.employeeId} onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))} placeholder={tp('select')} options={terminated} />
            </Field>
            <Field label={t('reason')} required>
              <Select value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value as SettlementReason }))} options={SETTLEMENT_REASONS.map((r) => ({ value: r, label: t(`reason_${r}`) }))} />
            </Field>
            <Field label={t('lastSalary')} hint={t('lastSalaryHint')}>
              <Input type="number" min={0} step="any" value={form.lastSalary} onChange={(e) => setForm((f) => ({ ...f, lastSalary: e.target.value }))} />
            </Field>
            <div className="flex items-end pb-2">
              <Checkbox label={t('encashLeave')} checked={form.encashLeave} onChange={(v) => setForm((f) => ({ ...f, encashLeave: v }))} />
            </div>
          </div>
          {itemEditor(t('otherAdditions'), additions, setAdditions)}
          {itemEditor(t('otherDeductions'), deductions, setDeductions)}
          <Field label={tc('notes')}>
            <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </Field>
          <FormActions onCancel={() => setOpen(false)} submitting={create.isPending} submitLabel={t('computeSettlement')} />
        </form>
      </Modal>

      <Modal isOpen={!!viewId} onClose={() => setViewId(null)} title={d ? `${d.settlementNumber} - ${empMap.get(d.employeeId) ?? ''}` : tc('loading')} size="xl">
        {d && (
          <div className="space-y-4">
            <KeyValue
              items={[
                { label: tc('status'), value: t(`settlement_${d.status}`) },
                { label: t('terminationDate'), value: d.terminationDate },
                { label: t('reason'), value: t(`reason_${d.reason}`) },
                { label: t('serviceYears'), value: Number(d.serviceYears).toFixed(2) },
                { label: t('monthlyWage'), value: money(d.monthlyWage) },
                { label: t('gratuityAmount'), value: money(d.gratuity) },
                { label: t('provisionUsed'), value: money(d.provisionUsed) },
                { label: t('leaveDaysEncashed'), value: Number(d.leaveDays) },
                { label: t('leaveEncashmentAmount'), value: money(d.leaveEncashment) },
                { label: t('lastSalary'), value: money(d.lastSalary) },
                { label: t('otherAdditions'), value: money(d.otherAdditions) },
                { label: t('loanDeduction'), value: money(d.loanDeduction) },
                { label: t('otherDeductions'), value: money(d.otherDeductions) },
                { label: t('totalEarnings'), value: money(d.totalEarnings) },
                { label: t('net'), value: <b>{money(d.net)}</b> },
                { label: t('postingDate'), value: d.postingDate ?? '-' },
                { label: t('paidDate'), value: d.paidDate ? `${d.paidDate} (${d.paymentMethod ? t(`method_${d.paymentMethod}`) : ''})` : '-' },
              ]}
            />
            {d.notes && <p className="text-sm text-gray-600">{d.notes}</p>}
            <div className="flex justify-end gap-2">
              {d.status === 'draft' && (
                <Button variant="success" onClick={() => startAction('post')}>
                  {t('postSettlement')}
                </Button>
              )}
              {d.status === 'posted' && (
                <Button variant="success" onClick={() => startAction('pay')}>
                  {t('pay')}
                </Button>
              )}
              {d.status !== 'cancelled' && (
                <Button variant="danger" onClick={() => startAction('cancel')}>
                  {tc('cancel')}
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={!!action}
        onClose={() => setAction(null)}
        title={action === 'post' ? t('postSettlement') : action === 'pay' ? t('pay') : tc('cancel')}
        size="sm"
      >
        <form onSubmit={(e) => { e.preventDefault(); act.mutate(undefined); }} className="space-y-4">
          <Field
            label={action === 'pay' ? tc('date') : action === 'post' ? t('postingDate') : t('reversalDate')}
            required={action === 'pay'}
            hint={action === 'post' ? t('settlementPostingHint') : action === 'cancel' ? t('settlementCancelHint') : undefined}
          >
            <Input type="date" required={action === 'pay'} value={actionForm.date} onChange={(e) => setActionForm((f) => ({ ...f, date: e.target.value }))} />
          </Field>
          {action === 'pay' && (
            <>
              <Field label={t('paymentMethod')} required>
                <Select
                  value={actionForm.method}
                  onChange={(e) => setActionForm((f) => ({ ...f, method: e.target.value as HrPaymentMethod }))}
                  options={['bank', 'cash'].map((v) => ({ value: v, label: t(`method_${v}`) }))}
                />
              </Field>
              <TreasuryPicker
                method={actionForm.method}
                value={actionForm.treasuryId}
                onChange={(treasuryId) => setActionForm((f) => (f.treasuryId === treasuryId ? f : { ...f, treasuryId }))}
              />
              {d && (
                <p className="text-sm">
                  {t('net')}: <b>{money(d.net)}</b>
                </p>
              )}
            </>
          )}
          <FormActions
            onCancel={() => setAction(null)}
            submitting={act.isPending}
            submitLabel={action === 'post' ? t('postSettlement') : action === 'pay' ? t('pay') : tc('confirm')}
          />
        </form>
      </Modal>
    </div>
  );
}
