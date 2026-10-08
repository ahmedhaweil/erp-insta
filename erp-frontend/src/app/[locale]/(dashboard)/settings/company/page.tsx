'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import PageHeader from '@/components/ui/PageHeader';
import { Btn, Card, Field, KeyValue, Spinner, inputCls } from '@/components/finance/ui';
import { useFinAction } from '@/hooks/use-finance';
import { adminService } from '@/services/finance-admin.service';

const FIELDS = ['name', 'taxId', 'phone', 'email', 'address'] as const;

export default function CompanyPage() {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const { data: tenant, isLoading } = useQuery({ queryKey: ['tenant-current'], queryFn: adminService.getCurrentTenant });
  const [form, setForm] = useState<Record<string, string>>({});

  useEffect(() => {
    if (tenant) {
      setForm({
        name: tenant.name ?? '',
        taxId: tenant.taxId ?? '',
        phone: tenant.phone ?? '',
        email: tenant.email ?? '',
        address: tenant.address ?? '',
        country: tenant.country ?? 'EG',
      });
    }
  }, [tenant]);

  const save = useFinAction(
    () =>
      adminService.updateTenant(tenant!.id, {
        name: form.name,
        country: form.country,
        taxId: form.taxId || undefined,
        phone: form.phone || undefined,
        email: form.email || undefined,
        address: form.address || undefined,
      } as any),
    { invalidate: ['tenant-current'] },
  );

  if (isLoading || !tenant) return <Spinner />;

  return (
    <div className="space-y-6">
      <PageHeader title={t('companyTitle')} />
      <Card>
        <KeyValue
          items={[
            { label: t('slug'), value: <span dir="ltr">{tenant.slug}</span> },
            { label: t('plan'), value: tenant.plan },
            { label: t('baseCurrency'), value: tenant.settings?.baseCurrency ?? '-' },
            { label: t('chartTemplate'), value: tenant.settings?.chartTemplate ? t(`template_${tenant.settings.chartTemplate}`) : '-' },
          ]}
        />
      </Card>
      <Card title={t('companyInfo')}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {FIELDS.map((f) => (
            <Field key={f} label={t(`company_${f}`)} className={f === 'address' ? 'md:col-span-2' : undefined}>
              <input
                className={inputCls}
                dir={f === 'email' || f === 'phone' || f === 'taxId' ? 'ltr' : undefined}
                value={form[f] ?? ''}
                onChange={(e) => setForm({ ...form, [f]: e.target.value })}
              />
            </Field>
          ))}
          <Field label={t('country')}>
            <select className={inputCls} value={form.country ?? 'EG'} onChange={(e) => setForm({ ...form, country: e.target.value })}>
              <option value="EG">{t('countryEG')}</option>
              <option value="SA">{t('countrySA')}</option>
            </select>
          </Field>
        </div>
        <div className="flex justify-end mt-4">
          <Btn onClick={() => save.mutate(undefined)} disabled={!form.name || save.isPending}>
            {save.isPending ? tc('loading') : tc('save')}
          </Btn>
        </div>
      </Card>
    </div>
  );
}
