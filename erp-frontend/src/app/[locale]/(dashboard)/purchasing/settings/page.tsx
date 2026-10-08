'use client';

import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import { EntityForm, type FieldDef } from '@/components/operations/form';
import { Card } from '@/components/operations/common';
import { useOpsMutation, useOpsQuery } from '@/hooks/use-operations';
import { opsPurchasing } from '@/services/operations-purchasing.service';

export default function PurchasingSettingsPage() {
  const t = useTranslations('ops');
  const { data, isLoading } = useOpsQuery(['purchasing-settings'], opsPurchasing.settings);
  const save = useOpsMutation((body: any) => opsPurchasing.updateSettings(body), { invalidate: ['purchasing-settings'] });
  const fields: FieldDef[] = [
    { name: 'poApprovalThreshold', label: t('pur.approvalThreshold'), type: 'number', min: 0, required: true, hint: t('pur.approvalThresholdHint'), wide: true },
    { name: 'requisitionApprovalRequired', label: t('pur.requisitionApprovalRequired'), type: 'checkbox', wide: true },
  ];
  return (
    <div className="max-w-2xl">
      <PageHeader title={t('pur.settings')} />
      <Card>
        {isLoading || !data ? (
          <p className="text-sm text-gray-500">{t('common.loading')}</p>
        ) : (
          <EntityForm
            fields={fields}
            initial={{ ...data, poApprovalThreshold: Number(data.poApprovalThreshold ?? 0) }}
            loading={save.isPending}
            onSubmit={(p) => save.mutate(p)}
            onCancel={() => history.back()}
          />
        )}
      </Card>
    </div>
  );
}
