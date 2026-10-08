'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import { Card, ErrorBox, Field, FormActions, Input, KeyValue, Select, useMoney } from '@/components/people/ui';
import { apiErrorMessage, useEmployeesLookup, useLabelMap, usePeopleMutation } from '@/hooks/use-people';
import { GRATUITY_REASONS, hrService, type GratuityResult } from '@/services/people-hr.service';

function GratuityCalculator() {
  const t = useTranslations('hr');
  const tc = useTranslations('common');
  const tp = useTranslations('people');
  const money = useMoney();
  const params = useSearchParams();
  const { data: employees } = useEmployeesLookup();
  const empMap = useLabelMap(employees);
  const [form, setForm] = useState({
    employeeId: params.get('employeeId') ?? '',
    country: 'SA',
    monthlyWage: '',
    startDate: '',
    endDate: '',
    reason: 'termination',
  });
  const [result, setResult] = useState<GratuityResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const calc = usePeopleMutation((body: Record<string, unknown>) => hrService.gratuity(body), {
    success: t('gratuityCalculated'),
    onSuccess: (res) => {
      setResult(res);
      setError(null);
    },
  });

  const set = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = { reason: form.reason, endDate: form.endDate || undefined };
    if (form.employeeId) {
      body.employeeId = form.employeeId;
      if (form.monthlyWage) body.monthlyWage = Number(form.monthlyWage);
      if (form.startDate) body.startDate = form.startDate;
    } else {
      Object.assign(body, { country: form.country, monthlyWage: Number(form.monthlyWage || 0), startDate: form.startDate });
    }
    calc.mutate(body, { onError: (err) => setError(apiErrorMessage(err, tc('error'))) });
  };
  const manual = !form.employeeId;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card title={t('gratuityInputs')}>
        <form onSubmit={submit} className="space-y-4">
          <Field label={t('employee')} hint={t('gratuityEmployeeHint')}>
            <Select value={form.employeeId} onChange={(e) => set('employeeId', e.target.value)} placeholder={t('manualEntry')} options={[...empMap].map(([value, label]) => ({ value, label }))} />
          </Field>
          {manual && (
            <Field label={t('payrollCountry')} required>
              <Select value={form.country} onChange={(e) => set('country', e.target.value)} options={['SA', 'EG'].map((v) => ({ value: v, label: t(`country_${v}`) }))} />
            </Field>
          )}
          <Field label={t('monthlyWage')} required={manual} hint={manual ? undefined : t('defaultsFromEmployee')}>
            <Input type="number" step="any" min={0} required={manual} value={form.monthlyWage} onChange={(e) => set('monthlyWage', e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t('serviceStart')} required={manual}>
              <Input type="date" required={manual} value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
            </Field>
            <Field label={t('serviceEnd')} hint={t('serviceEndHint')}>
              <Input type="date" value={form.endDate} onChange={(e) => set('endDate', e.target.value)} />
            </Field>
          </div>
          <Field label={t('endReason')} required>
            <Select value={form.reason} onChange={(e) => set('reason', e.target.value)} options={GRATUITY_REASONS.map((r) => ({ value: r, label: t(`reason_${r}`) }))} />
          </Field>
          <FormActions submitting={calc.isPending} submitLabel={tp('calculate')} />
        </form>
      </Card>
      <div className="space-y-4">
        <ErrorBox message={error} />
        {result && (
          <Card title={t('gratuityResult')}>
            <div className="text-3xl font-bold text-primary-700 mb-4">{money(result.amount)}</div>
            <KeyValue
              items={[
                { label: t('payrollCountry'), value: t(`country_${result.country}`) },
                { label: t('servicePeriod'), value: `${result.startDate} → ${result.endDate}` },
                { label: t('serviceYears'), value: `${result.serviceYears} (${result.serviceDays} ${t('daysUnit')})` },
                { label: t('monthlyWage'), value: money(result.monthlyWage) },
                { label: t('firstFiveYears'), value: money(result.firstFiveYearsAward) },
                { label: t('afterFiveYears'), value: money(result.afterFiveYearsAward) },
                { label: t('fullAward'), value: money(result.fullAward) },
                { label: t('entitlementFactor'), value: `${Math.round(result.entitlementFactor * 10000) / 100}%` },
                { label: t('statutory'), value: result.statutory ? tc('yes') : tc('no') },
              ]}
            />
            {result.country === 'EG' && <p className="mt-4 text-sm text-amber-700">{t('egGratuityNote')}</p>}
            <ul className="mt-4 list-disc ps-5 text-xs text-gray-500 space-y-1" dir="ltr">
              {result.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}

export default function GratuityPage() {
  const t = useTranslations('hr');
  return (
    <div>
      <PageHeader title={t('gratuity')} />
      <Suspense>
        <GratuityCalculator />
      </Suspense>
    </div>
  );
}
