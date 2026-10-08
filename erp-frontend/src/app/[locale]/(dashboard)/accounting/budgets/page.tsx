'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import DataTable from '@/components/ui/DataTable';
import ActionDialog from '@/components/finance/ActionDialog';
import { useAccountLabel } from '@/components/finance/AccountPicker';
import { Btn, Money } from '@/components/finance/ui';
import { useRouter } from '@/i18n/navigation';
import { byId, useFinAction, useFiscalYears } from '@/hooks/use-finance';
import { finAccountingService, type Budget } from '@/services/finance-accounting.service';

export default function BudgetsPage() {
  const t = useTranslations('acct');
  const tc = useTranslations('common');
  const router = useRouter();
  const accountLabel = useAccountLabel();
  const { data: budgets = [], isLoading } = useQuery({ queryKey: ['budgets'], queryFn: finAccountingService.getBudgets });
  const { data: years = [] } = useFiscalYears();
  const yearsById = byId(years);
  const [showNew, setShowNew] = useState(false);

  const create = useFinAction(finAccountingService.createBudget, { invalidate: ['budgets'], onSuccess: () => setShowNew(false) });

  const columns = [
    { key: 'fiscalYearId', header: t('fiscalYear'), render: (b: Budget) => yearsById[b.fiscalYearId]?.name ?? '' },
    { key: 'accountId', header: t('account'), render: (b: Budget) => accountLabel(b.accountId) },
    { key: 'period', header: t('period'), render: (b: Budget) => t(`period_${b.period}`) },
    { key: 'amount', header: t('plannedPerPeriod'), render: (b: Budget) => <Money value={b.amount} /> },
  ];

  const openYear = years.find((y) => y.status === 'open');

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('budgetsTitle')}</h1>
        <div className="flex gap-2">
          <Btn variant="secondary" onClick={() => router.push('/reports/budget-vs-actual')}>
            {t('budgetVsActual')}
          </Btn>
          <Btn onClick={() => setShowNew(true)}>{t('newBudget')}</Btn>
        </div>
      </div>
      <DataTable columns={columns} data={budgets} loading={isLoading} />
      <ActionDialog
        open={showNew}
        title={t('newBudget')}
        fields={[
          {
            name: 'fiscalYearId',
            label: t('fiscalYear'),
            type: 'select',
            required: true,
            defaultValue: openYear?.id,
            options: years.map((y) => ({ value: y.id, label: y.name })),
          },
          { name: 'accountId', label: t('account'), type: 'account', required: true },
          {
            name: 'period',
            label: t('period'),
            type: 'select',
            defaultValue: 'monthly',
            options: ['monthly', 'quarterly', 'annual'].map((p) => ({ value: p, label: t(`period_${p}`) })),
          },
          { name: 'amount', label: t('plannedPerPeriod'), type: 'number', required: true },
        ]}
        loading={create.isPending}
        onClose={() => setShowNew(false)}
        onSubmit={(v) => create.mutate(v as any)}
      />
    </div>
  );
}
