'use client';

import { useTranslations } from 'next-intl';
import SimpleCrud from '@/components/people/SimpleCrud';
import StatusBadge from '@/components/ui/StatusBadge';
import { hrService, type JobTitle } from '@/services/people-hr.service';
import { useLocalName } from '@/hooks/use-people';

export default function JobTitlesPage() {
  const t = useTranslations('hr');
  const tc = useTranslations('common');
  const name = useLocalName();

  return (
    <SimpleCrud<JobTitle>
      title={t('jobTitles')}
      newLabel={t('newJobTitle')}
      queryKey="hr-job-titles"
      load={hrService.jobTitles}
      create={hrService.createJobTitle}
      update={hrService.updateJobTitle}
      fields={[
        { name: 'code', label: tc('code'), required: true },
        { name: 'name', label: t('nameEn'), required: true },
        { name: 'nameAr', label: t('nameAr') },
        { name: 'isActive', label: tc('active'), type: 'checkbox', defaultValue: true },
      ]}
      columns={[
        { key: 'code', header: tc('code') },
        { key: 'name', header: tc('name'), render: (j) => name(j) },
        {
          key: 'isActive',
          header: tc('status'),
          render: (j) => <StatusBadge status={j.isActive ? 'active' : 'inactive'} label={j.isActive ? tc('active') : tc('inactive')} />,
        },
      ]}
    />
  );
}
