'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import SimpleCrud from '@/components/people/SimpleCrud';
import { Field, Input, Toolbar } from '@/components/people/ui';
import { hrService, type PublicHoliday } from '@/services/people-hr.service';

export default function HolidaysPage() {
  const t = useTranslations('hr');
  const tc = useTranslations('common');
  const tp = useTranslations('people');
  const [year, setYear] = useState(new Date().getFullYear());

  return (
    <SimpleCrud<PublicHoliday>
      key={year}
      title={t('holidays')}
      newLabel={t('newHoliday')}
      queryKey="hr-holidays"
      load={() => hrService.holidays(year)}
      create={hrService.createHoliday}
      remove={hrService.deleteHoliday}
      toolbar={
        <Toolbar>
          <Field label={tp('year')}>
            <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-32" />
          </Field>
        </Toolbar>
      }
      fields={[
        { name: 'date', label: tc('date'), type: 'date', required: true },
        { name: 'name', label: tc('name'), required: true },
      ]}
      columns={[
        { key: 'date', header: tc('date'), render: (h) => String(h.date).slice(0, 10) },
        { key: 'name', header: tc('name') },
      ]}
    />
  );
}
