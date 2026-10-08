'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { Button, Card, ErrorBox, Field, Input } from '@/components/people/ui';
import { apiErrorMessage, usePeopleMutation, usePeopleQuery } from '@/hooks/use-people';
import { hrService, type PayrollRules } from '@/services/people-hr.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const RATE_FIELDS: Record<'EG' | 'SA', string[]> = {
  EG: ['siEmployeeRate', 'siEmployerRate'],
  SA: ['gosiSaudiEmployeeRate', 'gosiSaudiEmployerRate', 'gosiNonSaudiEmployeeRate', 'gosiNonSaudiEmployerRate'],
};
const AMOUNT_FIELDS: Record<'general' | 'EG' | 'SA', string[]> = {
  general: ['daysPerMonth', 'absenceDeductionMultiplier', 'lateDeductionMultiplier'],
  EG: ['minInsurableWage', 'maxInsurableWage', 'personalExemption', 'overtimeMultiplier'],
  SA: ['minContributoryWage', 'maxContributoryWage', 'overtimeMultiplier'],
};

/** Client-side checks mirroring the backend validation (backend errors are shown too). */
function validate(rules: PayrollRules, t: (key: string, values?: any) => string): string[] {
  const errors: string[] = [];
  const pct = (v: number) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
  for (const country of ['EG', 'SA'] as const) {
    for (const f of RATE_FIELDS[country]) {
      if (!pct((rules[country] as any)[f])) errors.push(t('errRate', { field: t(`rule_${f}`) }));
    }
  }
  rules.EG.taxBrackets.forEach((b, i) => {
    if (!pct(b.rate)) errors.push(t('errBracketRate', { n: i + 1 }));
  });
  if (rules.EG.minInsurableWage > rules.EG.maxInsurableWage) errors.push(t('errEgWageCap'));
  if (rules.SA.minContributoryWage > rules.SA.maxContributoryWage) errors.push(t('errSaWageCap'));
  const brackets = rules.EG.taxBrackets;
  if (!brackets.length || brackets[brackets.length - 1].upTo !== null) errors.push(t('errLastBracket'));
  for (let i = 0; i < brackets.length - 1; i++) {
    const upTo = brackets[i].upTo;
    if (upTo === null || !Number.isFinite(upTo)) errors.push(t('errBracketBound', { n: i + 1 }));
    else if (i > 0 && upTo <= (brackets[i - 1].upTo as number)) errors.push(t('errBracketOrder', { n: i + 1 }));
  }
  if (!(rules.general.daysPerMonth > 0)) errors.push(t('errDaysPerMonth'));
  return errors;
}

export default function HrSettingsPage() {
  const t = useTranslations('hr');
  const tc = useTranslations('common');
  const tp = useTranslations('people');
  const { data, isLoading } = usePeopleQuery(['hr-settings'], hrService.settings);
  const [rules, setRules] = useState<PayrollRules | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (data) setRules(structuredClone(data.effective));
  }, [data]);

  const save = usePeopleMutation((body: Record<string, any>) => hrService.updateSettings(body), {
    invalidate: ['hr-settings'],
    success: t('settingsSaved'),
    onSuccess: () => {
      setServerError(null);
      setConfirmReset(false);
    },
  });

  if (isLoading || !rules) return <div className="text-gray-500">{tc('loading')}</div>;

  const setValue = (section: 'general' | 'EG' | 'SA', field: string, value: number) =>
    setRules((prev) => (prev ? { ...prev, [section]: { ...prev[section], [field]: value } } : prev));

  const setBracket = (index: number, patch: Partial<{ upTo: number | null; rate: number }>) =>
    setRules((prev) => {
      if (!prev) return prev;
      const taxBrackets = prev.EG.taxBrackets.map((b, i) => (i === index ? { ...b, ...patch } : b));
      return { ...prev, EG: { ...prev.EG, taxBrackets } };
    });

  const addBracket = () =>
    setRules((prev) => {
      if (!prev) return prev;
      const list = [...prev.EG.taxBrackets];
      const last = list.pop() ?? { upTo: null, rate: 0 };
      const before = list.length ? (list[list.length - 1].upTo as number) : 0;
      list.push({ upTo: before + 10000, rate: last.rate }, last);
      return { ...prev, EG: { ...prev.EG, taxBrackets: list } };
    });

  const removeBracket = (index: number) =>
    setRules((prev) =>
      prev ? { ...prev, EG: { ...prev.EG, taxBrackets: prev.EG.taxBrackets.filter((_, i) => i !== index) } } : prev,
    );

  const submit = () => {
    const found = validate(rules, t as any);
    setErrors(found);
    if (found.length) return;
    save.mutate(rules as any, { onError: (err) => setServerError(apiErrorMessage(err, tc('error'))) });
  };

  const numberInput = (section: 'general' | 'EG' | 'SA', field: string, percent = false) => {
    const raw = (rules[section] as any)[field];
    return (
      <Field key={`${section}.${field}`} label={t(`rule_${field}`) + (percent ? ' (%)' : '')}>
        <Input
          type="number"
          step="any"
          value={percent ? Math.round(raw * 1000000) / 10000 : raw}
          onChange={(e) => setValue(section, field, e.target.value === '' ? NaN : Number(e.target.value) / (percent ? 100 : 1))}
        />
      </Field>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t('settings')} />
      <p className="text-sm text-gray-600">{t('settingsHint')}</p>
      {errors.length > 0 && <ErrorBox message={errors.join('\n')} />}
      <ErrorBox message={serverError} />

      <Card title={t('generalRules')}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">{AMOUNT_FIELDS.general.map((f) => numberInput('general', f))}</div>
      </Card>

      <Card title={t('egyptRules')}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {RATE_FIELDS.EG.map((f) => numberInput('EG', f, true))}
          {AMOUNT_FIELDS.EG.map((f) => numberInput('EG', f))}
        </div>
        <h3 className="font-medium text-gray-900 mt-6 mb-2">{t('taxBrackets')}</h3>
        <p className="text-xs text-gray-500 mb-3">{t('taxBracketsHint')}</p>
        <table className="w-full text-sm max-w-xl">
          <thead>
            <tr className="text-gray-600">
              <th className="text-start py-1">#</th>
              <th className="text-start py-1">{t('upTo')}</th>
              <th className="text-start py-1">{t('ratePercent')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rules.EG.taxBrackets.map((b, i) => {
              const last = i === rules.EG.taxBrackets.length - 1;
              return (
                <tr key={i}>
                  <td className="py-1 pe-2">{i + 1}</td>
                  <td className="py-1 pe-2">
                    {last ? (
                      <span className="text-gray-500">{t('unbounded')}</span>
                    ) : (
                      <Input type="number" step="any" value={b.upTo ?? ''} onChange={(e) => setBracket(i, { upTo: e.target.value === '' ? NaN : Number(e.target.value) })} />
                    )}
                  </td>
                  <td className="py-1 pe-2">
                    <Input type="number" step="any" value={Math.round(b.rate * 1000000) / 10000} onChange={(e) => setBracket(i, { rate: e.target.value === '' ? NaN : Number(e.target.value) / 100 })} />
                  </td>
                  <td className="py-1">
                    {!last && rules.EG.taxBrackets.length > 1 && (
                      <button type="button" className="text-red-600 text-sm hover:underline" onClick={() => removeBracket(i)}>
                        {tp('remove')}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Button variant="ghost" className="mt-2" onClick={addBracket}>
          + {t('addBracket')}
        </Button>
      </Card>

      <Card title={t('saudiRules')}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {RATE_FIELDS.SA.map((f) => numberInput('SA', f, true))}
          {AMOUNT_FIELDS.SA.map((f) => numberInput('SA', f))}
          <Field label={t('rule_contributoryAllowanceCodes')} hint={t('codesHint')}>
            <Input
              value={rules.SA.contributoryAllowanceCodes.join(', ')}
              onChange={(e) =>
                setRules({ ...rules, SA: { ...rules.SA, contributoryAllowanceCodes: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) } })
              }
            />
          </Field>
        </div>
      </Card>

      <div className="flex gap-3 justify-end">
        <Button variant="secondary" onClick={() => setConfirmReset(true)}>
          {t('resetDefaults')}
        </Button>
        <Button onClick={submit} disabled={save.isPending}>
          {save.isPending ? tc('loading') : tc('save')}
        </Button>
      </div>
      <ConfirmDialog
        isOpen={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={() => save.mutate({})}
        title={t('resetDefaults')}
        message={t('resetDefaultsConfirm')}
        loading={save.isPending}
      />
    </div>
  );
}
