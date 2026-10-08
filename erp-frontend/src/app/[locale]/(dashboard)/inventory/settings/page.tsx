'use client';

import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import { EntityForm, type FieldDef } from '@/components/operations/form';
import { Card } from '@/components/operations/common';
import { useOpsMutation, useOpsQuery } from '@/hooks/use-operations';
import { opsInventory } from '@/services/operations-inventory.service';

export default function InventorySettingsPage() {
  const t = useTranslations('ops');
  const { data, isLoading } = useOpsQuery(['inventory-settings'], opsInventory.settings);
  const save = useOpsMutation((body: any) => opsInventory.updateSettings(body), { invalidate: ['inventory-settings'] });
  const fields: FieldDef[] = [
    { name: 'allowNegativeStock', label: t('inv.allowNegativeStock'), type: 'checkbox', wide: true },
    { name: 'expiryAlertDays', label: t('inv.expiryAlertDays'), type: 'number', min: 1, max: 3650, required: true, hint: t('inv.expiryAlertDaysHint') },
  ];
  return (
    <div className="max-w-2xl">
      <PageHeader title={t('inv.settings')} />
      <Card>
        {isLoading || !data ? (
          <p className="text-sm text-gray-500">{t('common.loading')}</p>
        ) : (
          <EntityForm fields={fields} initial={data} loading={save.isPending} onSubmit={(p) => save.mutate(p)} onCancel={() => history.back()} />
        )}
      </Card>
    </div>
  );
}
