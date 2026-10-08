'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import { Button, Card, Checkbox, ErrorBox, Field, Input, Select, SimpleTable, td, useMoney } from '@/components/people/ui';
import {
  apiErrorMessage,
  useBranches,
  useDepartments,
  useEmployeesLookup,
  useJobTitles,
  useLabelMap,
  useLocalName,
  usePeopleMutation,
  usePeopleQuery,
  useSchedules,
  useUsers,
} from '@/hooks/use-people';
import { hrService, type Allowance, type Employee } from '@/services/people-hr.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const TEXT_FIELDS = ['code', 'nameEn', 'nameAr', 'nationalId', 'nationality', 'gender', 'email', 'phone', 'bankName', 'bankAccount', 'iban', 'socialInsuranceNumber'] as const;
const DATE_FIELDS = ['birthDate', 'hireDate', 'contractEndDate'] as const;
const REF_FIELDS = ['branchId', 'departmentId', 'jobTitleId', 'managerId', 'workScheduleId', 'userId'] as const;

const empty = {
  code: '', nameEn: '', nameAr: '', idType: 'national_id', nationalId: '', nationality: 'EG', birthDate: '', gender: '',
  email: '', phone: '', hireDate: new Date().toISOString().slice(0, 10), branchId: '', departmentId: '', jobTitleId: '',
  managerId: '', workScheduleId: '', userId: '', bankName: '', bankAccount: '', iban: '', contractType: 'permanent',
  contractEndDate: '', basicSalary: '', socialInsuranceWage: '', socialInsuranceNumber: '', socialInsuranceEnrolled: true,
  payrollCountry: 'EG', trackAttendance: false,
};
type FormState = typeof empty;

function fromEmployee(e: Employee): FormState {
  const s: any = { ...empty };
  for (const key of Object.keys(empty)) {
    const v = (e as any)[key];
    if (v !== null && v !== undefined) s[key] = typeof v === 'number' ? String(v) : v;
  }
  for (const d of DATE_FIELDS) s[d] = s[d] ? String(s[d]).slice(0, 10) : '';
  s.basicSalary = String(Number(e.basicSalary));
  s.socialInsuranceWage = e.socialInsuranceWage != null ? String(Number(e.socialInsuranceWage)) : '';
  return s;
}

export default function EmployeeFormPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'new';
  const t = useTranslations('hr');
  const tc = useTranslations('common');
  const tp = useTranslations('people');
  const router = useRouter();
  const money = useMoney();
  const localName = useLocalName();
  const { data: employee } = usePeopleQuery(['hr-employees', id], () => hrService.employee(id), !isNew);
  const year = new Date().getFullYear();
  const { data: balances } = usePeopleQuery(['hr-leave-balances', id, year], () => hrService.employeeBalances(id, year), !isNew);
  const [form, setForm] = useState<FormState>(empty);
  const [allowances, setAllowances] = useState<Allowance[]>([]);
  const [error, setError] = useState<string | null>(null);

  const { data: branches } = useBranches();
  const { data: departments } = useDepartments();
  const { data: jobTitles } = useJobTitles();
  const { data: schedules } = useSchedules();
  const { data: employees } = useEmployeesLookup('active');
  const { data: users } = useUsers();
  const options = {
    branchId: useLabelMap(branches),
    departmentId: useLabelMap(departments),
    jobTitleId: useLabelMap(jobTitles),
    workScheduleId: useLabelMap(schedules, false),
    managerId: useLabelMap(employees?.filter((e) => e.id !== id)),
    userId: new Map((users ?? []).map((u) => [u.id, `${u.name ?? ''} (${u.email ?? ''})`])),
  };

  useEffect(() => {
    if (employee) {
      setForm(fromEmployee(employee));
      setAllowances((employee.allowances ?? []).map((a) => ({ ...a, amount: Number(a.amount) })));
    }
  }, [employee]);

  const save = usePeopleMutation(
    (body: Record<string, any>) => (isNew ? hrService.createEmployee(body) : hrService.updateEmployee(id, body)),
    {
      invalidate: ['hr-employees'],
      success: t('employeeSaved'),
      onSuccess: (saved: any) => {
        setError(null);
        if (isNew) router.replace(`/hr/employees/${saved.id}`);
      },
    },
  );

  const set = (key: keyof FormState, value: any) => setForm((f) => ({ ...f, [key]: value }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, any> = {};
    for (const key of TEXT_FIELDS) {
      if (key === 'code' && !isNew) continue;
      const v = (form[key] as string).trim();
      if (v) body[key] = key === 'nationality' ? v.toUpperCase() : v;
    }
    for (const key of DATE_FIELDS) if (form[key]) body[key] = form[key];
    for (const key of REF_FIELDS) {
      if (form[key]) body[key] = form[key];
      else if (!isNew) body[key] = null;
    }
    body.idType = form.idType;
    body.contractType = form.contractType;
    body.payrollCountry = form.payrollCountry;
    body.basicSalary = Number(form.basicSalary || 0);
    if (form.socialInsuranceWage !== '') body.socialInsuranceWage = Number(form.socialInsuranceWage);
    body.socialInsuranceEnrolled = form.socialInsuranceEnrolled;
    body.trackAttendance = form.trackAttendance;
    body.allowances = allowances
      .filter((a) => a.code.trim() || a.name.trim())
      .map((a) => ({ code: a.code.trim(), name: a.name.trim() || a.code.trim(), amount: Number(a.amount || 0) }));
    save.mutate(body, { onError: (err) => setError(apiErrorMessage(err, tc('error'))) });
  };

  const text = (key: keyof FormState, label: string, props: Record<string, any> = {}) => (
    <Field label={label} required={props.required}>
      <Input value={form[key] as string} onChange={(e) => set(key, e.target.value)} {...props} />
    </Field>
  );
  const ref = (key: (typeof REF_FIELDS)[number], label: string) => (
    <Field label={label}>
      <Select
        value={form[key]}
        onChange={(e) => set(key, e.target.value)}
        placeholder={tp('none')}
        options={[...options[key].entries()].map(([value, l]) => ({ value, label: l }))}
      />
    </Field>
  );

  const allowanceTotal = allowances.reduce((s, a) => s + Number(a.amount || 0), 0);

  return (
    <form onSubmit={submit} className="space-y-6">
      <PageHeader title={isNew ? t('newEmployee') : `${employee?.code ?? ''} - ${localName(employee)}`} />
      {employee?.status === 'terminated' && (
        <div className="p-3 rounded-lg bg-yellow-50 border border-yellow-200 text-sm text-yellow-800">
          {t('terminatedOn', { date: String(employee.terminationDate ?? '').slice(0, 10), reason: employee.terminationReason ?? '' })}
        </div>
      )}
      <ErrorBox message={error} />

      <Card title={t('personalInfo')}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {text('code', tc('code'), { disabled: !isNew, placeholder: isNew ? t('codeAutoHint') : undefined })}
          {text('nameEn', t('nameEn'), { required: true })}
          {text('nameAr', t('nameAr'))}
          <Field label={t('idType')}>
            <Select
              value={form.idType}
              onChange={(e) => set('idType', e.target.value)}
              options={['national_id', 'iqama', 'passport'].map((v) => ({ value: v, label: t(`idType_${v}`) }))}
            />
          </Field>
          {text('nationalId', t('nationalId'))}
          {text('nationality', t('nationality'), { maxLength: 2, placeholder: 'EG / SA' })}
          {text('birthDate', t('birthDate'), { type: 'date' })}
          <Field label={t('gender')}>
            <Select value={form.gender} onChange={(e) => set('gender', e.target.value)} placeholder={tp('none')} options={['male', 'female'].map((v) => ({ value: v, label: t(`gender_${v}`) }))} />
          </Field>
          {text('email', tc('email'), { type: 'email' })}
          {text('phone', tc('phone'))}
        </div>
      </Card>

      <Card title={t('employment')}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {text('hireDate', t('hireDate'), { type: 'date', required: true })}
          <Field label={t('contractType')}>
            <Select
              value={form.contractType}
              onChange={(e) => set('contractType', e.target.value)}
              options={['permanent', 'fixed_term', 'part_time', 'temporary'].map((v) => ({ value: v, label: t(`contract_${v}`) }))}
            />
          </Field>
          {text('contractEndDate', t('contractEndDate'), { type: 'date' })}
          {ref('branchId', t('branch'))}
          {ref('departmentId', t('department'))}
          {ref('jobTitleId', t('jobTitle'))}
          {ref('managerId', t('manager'))}
          {ref('workScheduleId', t('workSchedule'))}
          {ref('userId', t('linkedUser'))}
          <div className="flex items-end">
            <Checkbox label={t('trackAttendance')} checked={form.trackAttendance} onChange={(v) => set('trackAttendance', v)} />
          </div>
        </div>
      </Card>

      <Card title={t('salary')}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label={t('payrollCountry')}>
            <Select value={form.payrollCountry} onChange={(e) => set('payrollCountry', e.target.value)} options={['EG', 'SA'].map((v) => ({ value: v, label: t(`country_${v}`) }))} />
          </Field>
          {text('basicSalary', t('basicSalary'), { type: 'number', step: 'any', min: 0, required: true })}
          {text('socialInsuranceWage', t('socialInsuranceWage'), { type: 'number', step: 'any', min: 0, placeholder: t('siWageHint') })}
          {text('socialInsuranceNumber', t('socialInsuranceNumber'))}
          <div className="flex items-end">
            <Checkbox label={t('socialInsuranceEnrolled')} checked={form.socialInsuranceEnrolled} onChange={(v) => set('socialInsuranceEnrolled', v)} />
          </div>
        </div>

        <h3 className="font-medium text-gray-900 mt-6 mb-2">{t('allowances')}</h3>
        <p className="text-xs text-gray-500 mb-2">{t('allowancesHint')}</p>
        <div className="space-y-2">
          {allowances.map((a, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <Input className="col-span-3" placeholder={t('allowanceCode')} value={a.code} onChange={(e) => setAllowances((l) => l.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)))} />
              <Input className="col-span-5" placeholder={tc('name')} value={a.name} onChange={(e) => setAllowances((l) => l.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <Input className="col-span-3" type="number" step="any" min={0} placeholder={tc('amount')} value={a.amount} onChange={(e) => setAllowances((l) => l.map((x, j) => (j === i ? { ...x, amount: e.target.value as any } : x)))} />
              <button type="button" className="col-span-1 text-red-600 text-sm hover:underline" onClick={() => setAllowances((l) => l.filter((_, j) => j !== i))}>
                {tp('remove')}
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between mt-3">
          <Button variant="ghost" onClick={() => setAllowances((l) => [...l, { code: l.length ? '' : 'housing', name: '', amount: 0 }])}>
            + {t('addAllowance')}
          </Button>
          <span className="text-sm text-gray-700">
            {t('monthlyWage')}: <b>{money(Number(form.basicSalary || 0) + allowanceTotal)}</b>
          </span>
        </div>
      </Card>

      <Card title={t('bank')}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {text('bankName', t('bankName'))}
          {text('bankAccount', t('bankAccount'))}
          {text('iban', t('iban'))}
        </div>
      </Card>

      {!isNew && balances && (
        <Card title={`${t('leaveBalances')} ${year}`}>
          <SimpleTable headers={[t('leaveType'), t('entitlement'), t('taken'), t('pending'), t('remaining')]}>
            {balances.map((b) => (
              <tr key={b.leaveTypeId}>
                <td className={td}>{b.leaveTypeName}</td>
                <td className={td}>{b.entitlement}</td>
                <td className={td}>{b.taken}</td>
                <td className={td}>{b.pending}</td>
                <td className={td}>{b.remaining}</td>
              </tr>
            ))}
          </SimpleTable>
        </Card>
      )}

      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={() => router.push('/hr/employees')}>
          {tc('back')}
        </Button>
        {!isNew && (
          <Button variant="secondary" onClick={() => router.push(`/hr/gratuity?employeeId=${id}`)}>
            {t('gratuity')}
          </Button>
        )}
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? tc('loading') : tc('save')}
        </Button>
      </div>
    </form>
  );
}
