'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import ActionDialog from '@/components/finance/ActionDialog';
import { Btn } from '@/components/finance/ui';
import { useFinAction, useFiscalYears } from '@/hooks/use-finance';
import { finAccountingService, type FiscalYear } from '@/services/finance-accounting.service';

export default function FiscalYearsPage() {
  const t = useTranslations('acct');
  const tc = useTranslations('common');
  const { data: years = [], isLoading } = useFiscalYears();
  const [showNew, setShowNew] = useState(false);
  const [closing, setClosing] = useState<FiscalYear | null>(null);

  const create = useFinAction(finAccountingService.createFiscalYear, { invalidate: ['fiscal-years'], onSuccess: () => setShowNew(false) });
  const close = useFinAction(finAccountingService.closeFiscalYear, {
    invalidate: ['fiscal-years', 'fin-journal-entries'],
    success: t('fiscalYearClosed'),
    onSuccess: () => setClosing(null),
  });

  const nextYear = (() => {
    const last = [...years].sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
    const y = last ? Number(last.endDate.slice(0, 4)) + 1 : new Date().getFullYear();
    return y;
  })();

  const columns = [
    { key: 'name', header: tc('name') },
    { key: 'startDate', header: t('startDate') },
    { key: 'endDate', header: t('endDate') },
    {
      key: 'status',
      header: tc('status'),
      render: (y: FiscalYear) => <StatusBadge status={y.status} label={t(`fy_${y.status}`)} />,
    },
  ];

  return (
    <div>
      <PageHeader title={t('fiscalYearsTitle')} action={{ label: t('newFiscalYear'), onClick: () => setShowNew(true) }} />
      <DataTable
        columns={columns}
        data={years}
        loading={isLoading}
        actions={(y) =>
          y.status === 'open' ? (
            <Btn size="sm" variant="ghost" onClick={() => setClosing(y)}>
              {t('closeYear')}
            </Btn>
          ) : null
        }
      />
      <ActionDialog
        open={showNew}
        title={t('newFiscalYear')}
        fields={[
          { name: 'name', label: tc('name'), type: 'text', required: true, defaultValue: `FY ${nextYear}` },
          { name: 'startDate', label: t('startDate'), type: 'date', required: true, defaultValue: `${nextYear}-01-01` },
          { name: 'endDate', label: t('endDate'), type: 'date', required: true, defaultValue: `${nextYear}-12-31` },
        ]}
        loading={create.isPending}
        onClose={() => setShowNew(false)}
        onSubmit={(v) => create.mutate(v as any)}
      />
      <ConfirmDialog
        isOpen={!!closing}
        onClose={() => setClosing(null)}
        onConfirm={() => closing && close.mutate(closing.id)}
        title={t('closeYear')}
        message={t('closeYearConfirm', { name: closing?.name ?? '' })}
        destructive
        loading={close.isPending}
      />
    </div>
  );
}
