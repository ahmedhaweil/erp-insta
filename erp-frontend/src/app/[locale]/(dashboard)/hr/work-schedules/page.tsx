'use client';

import { useTranslations } from 'next-intl';
import SimpleCrud from '@/components/people/SimpleCrud';
import { hrService, type WorkSchedule } from '@/services/people-hr.service';

export default function WorkSchedulesPage() {
  const t = useTranslations('hr');
  const tc = useTranslations('common');
  const tp = useTranslations('people');

  return (
    <SimpleCrud<WorkSchedule>
      title={t('workSchedules')}
      newLabel={t('newWorkSchedule')}
      queryKey="hr-work-schedules"
      load={hrService.schedules}
      create={hrService.createSchedule}
      update={hrService.updateSchedule}
      fields={[
        { name: 'name', label: tc('name'), required: true },
        { name: 'dailyHours', label: t('dailyHours'), type: 'number', defaultValue: 8, step: '0.5' },
        { name: 'startTime', label: t('startTime'), type: 'time', defaultValue: '09:00' },
        { name: 'graceMinutes', label: t('graceMinutes'), type: 'number', defaultValue: 0, step: '1' },
        { name: 'weekendDays', label: t('weekendDays'), type: 'weekdays', defaultValue: [5, 6] },
        { name: 'isDefault', label: t('isDefault'), type: 'checkbox' },
      ]}
      columns={[
        { key: 'name', header: tc('name') },
        { key: 'dailyHours', header: t('dailyHours'), render: (s) => Number(s.dailyHours) },
        { key: 'startTime', header: t('startTime') },
        { key: 'graceMinutes', header: t('graceMinutes') },
        { key: 'weekendDays', header: t('weekendDays'), render: (s) => (s.weekendDays ?? []).map((d) => tp(`weekday${d}`)).join(', ') },
        { key: 'isDefault', header: t('isDefault'), render: (s) => (s.isDefault ? tc('yes') : tc('no')) },
      ]}
    />
  );
}
