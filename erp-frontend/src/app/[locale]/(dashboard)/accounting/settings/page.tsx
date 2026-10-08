'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import PageHeader from '@/components/ui/PageHeader';
import AccountPicker from '@/components/finance/AccountPicker';
import { Btn, Card, Field, Spinner, inputCls } from '@/components/finance/ui';
import { Link } from '@/i18n/navigation';
import { useFinAction } from '@/hooks/use-finance';
import { finAccountingService, type AccountingSettings } from '@/services/finance-accounting.service';

const GROUPS: { key: string; accounts: string[] }[] = [
  { key: 'groupPartners', accounts: ['receivable', 'payable', 'notesReceivable', 'chequesUnderCollection', 'notesPayable'] },
  { key: 'groupSales', accounts: ['sales', 'salesReturn', 'salesDiscount', 'commissionExpense', 'commissionPayable', 'installmentInterest'] },
  { key: 'groupPurchases', accounts: ['purchase', 'purchaseReturn'] },
  { key: 'groupInventory', accounts: ['inventory', 'cogs', 'stockAdjustment', 'manufacturingOverhead'] },
  { key: 'groupTax', accounts: ['outputTax', 'inputTax', 'withholdingTaxReceivable', 'withholdingTaxPayable'] },
  { key: 'groupTreasury', accounts: ['cash', 'bank', 'bankCharges', 'fxGain', 'fxLoss'] },
  { key: 'groupAssets', accounts: ['depreciationExpense', 'accumulatedDepreciation', 'assetDisposal', 'retainedEarnings'] },
  {
    key: 'groupPayroll',
    accounts: ['salariesExpense', 'salariesPayable', 'socialInsuranceExpense', 'socialInsurancePayable', 'payrollTaxPayable', 'employeeAdvances'],
  },
];

export default function AccountingSettingsPage() {
  const t = useTranslations('acct');
  const tc = useTranslations('common');
  const { data: settings, isLoading } = useQuery({ queryKey: ['accounting-settings'], queryFn: finAccountingService.getSettings });
  const [form, setForm] = useState<Record<string, string>>({});

  useEffect(() => {
    if (settings) {
      const f: Record<string, string> = {};
      for (const [k, v] of Object.entries(settings)) {
        if (k.endsWith('AccountId') || k === 'lockDate') f[k] = (v as string) ?? '';
      }
      setForm(f);
    }
  }, [settings]);

  const save = useFinAction(
    () => {
      // a cleared account (or lock date) is sent as null so the server clears it
      const payload: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(form)) payload[k] = v || null;
      return finAccountingService.updateSettings(payload as AccountingSettings);
    },
    { invalidate: ['accounting-settings'] },
  );

  if (isLoading) return <Spinner />;

  return (
    <div className="space-y-6">
      <PageHeader title={t('settingsTitle')} />
      {!settings && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          {t('noSettings')}{' '}
          <Link href="/accounting/setup" className="underline font-medium">
            {t('goToSetup')}
          </Link>
        </div>
      )}

      <Card title={t('lockDate')}>
        <div className="flex flex-wrap items-end gap-4">
          <Field label={t('lockDate')} hint={t('lockDateHint')} className="w-64">
            <input type="date" className={inputCls} value={form.lockDate ?? ''} onChange={(e) => setForm({ ...form, lockDate: e.target.value })} />
          </Field>
        </div>
      </Card>

      {GROUPS.map((g) => (
        <Card key={g.key} title={t(g.key)}>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {g.accounts.map((a) => {
              const key = `${a}AccountId`;
              return (
                <Field key={key} label={t(`acc_${a}`)}>
                  <AccountPicker value={form[key]} onChange={(id) => setForm({ ...form, [key]: id })} />
                </Field>
              );
            })}
          </div>
        </Card>
      ))}

      <div className="sticky bottom-0 bg-gray-50/90 backdrop-blur py-3 flex justify-end">
        <Btn onClick={() => save.mutate(undefined)} disabled={save.isPending}>
          {save.isPending ? tc('loading') : tc('save')}
        </Btn>
      </div>
    </div>
  );
}
