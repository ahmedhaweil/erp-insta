'use client';

import { useTranslations } from 'next-intl';
import SimpleCrud from '@/components/people/SimpleCrud';
import StatusBadge from '@/components/ui/StatusBadge';
import { crmService, type CrmStage } from '@/services/people-crm.service';
import { useLocalName } from '@/hooks/use-people';

export default function StagesPage() {
  const t = useTranslations('crm');
  const tc = useTranslations('common');
  const name = useLocalName();

  return (
    <SimpleCrud<CrmStage>
      title={t('stages')}
      newLabel={t('newStage')}
      queryKey="crm-stages"
      load={async () => (await crmService.stages(true)).sort((a, b) => a.sequence - b.sequence)}
      create={crmService.createStage}
      update={crmService.updateStage}
      remove={crmService.deleteStage}
      fields={[
        { name: 'name', label: t('nameEn'), required: true },
        { name: 'nameAr', label: t('nameAr') },
        { name: 'sequence', label: t('sequence'), type: 'number', step: '1', defaultValue: 10 },
        { name: 'probability', label: t('probability'), type: 'number', defaultValue: 10 },
        { name: 'isWon', label: t('isWonStage'), type: 'checkbox' },
        { name: 'isActive', label: tc('active'), type: 'checkbox', defaultValue: true },
      ]}
      columns={[
        { key: 'sequence', header: t('sequence') },
        { key: 'name', header: tc('name'), render: (s) => name(s) },
        { key: 'probability', header: t('probability'), render: (s) => `${Number(s.probability)}%` },
        { key: 'isWon', header: t('isWonStage'), render: (s) => (s.isWon ? tc('yes') : tc('no')) },
        { key: 'isActive', header: tc('status'), render: (s) => <StatusBadge status={s.isActive ? 'active' : 'inactive'} label={s.isActive ? tc('active') : tc('inactive')} /> },
      ]}
    />
  );
}
