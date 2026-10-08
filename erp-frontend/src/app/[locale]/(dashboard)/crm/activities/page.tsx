'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import { ActivityFormModal, ActivityTable } from '@/components/people/ActivityList';
import { Checkbox, Tabs } from '@/components/people/ui';
import { useCustomers, useLabelMap, usePeopleQuery } from '@/hooks/use-people';
import { crmService, type ActivityState, type CrmActivity } from '@/services/people-crm.service';

const STATES: ActivityState[] = ['overdue', 'today', 'planned', 'done', 'cancelled'];

export default function ActivitiesPage() {
  const t = useTranslations('crm');
  const tc = useTranslations('common');
  const [state, setState] = useState<ActivityState>('overdue');
  const [everyone, setEveryone] = useState(false);
  const [open, setOpen] = useState(false);
  const { data = [], isLoading } = usePeopleQuery(['crm-activities', everyone ? 'all' : 'my', state], () =>
    everyone ? crmService.activities({ state }) : crmService.myActivities(state),
  );
  const { data: overdue = [] } = usePeopleQuery(['crm-activities', everyone ? 'all' : 'my', 'overdue'], () =>
    everyone ? crmService.activities({ state: 'overdue' }) : crmService.myActivities('overdue'),
  );
  const { data: todayList = [] } = usePeopleQuery(['crm-activities', everyone ? 'all' : 'my', 'today'], () =>
    everyone ? crmService.activities({ state: 'today' }) : crmService.myActivities('today'),
  );
  const { data: leads = [] } = usePeopleQuery(['crm-leads', 'open-lookup'], () => crmService.leads({ status: 'open' }));
  const { data: customers } = useCustomers();
  const customerMap = useLabelMap(customers);
  const leadMap = new Map(leads.map((l) => [l.id, `${l.leadNumber} - ${l.title}`]));
  const related = (a: CrmActivity) => (a.leadId ? leadMap.get(a.leadId) ?? t('lead') : a.customerId ? customerMap.get(a.customerId) ?? t('customer') : '-');

  return (
    <div>
      <PageHeader title={t('activities')} action={{ label: t('scheduleActivity'), onClick: () => setOpen(true) }} />
      <div className="flex items-center justify-between">
        <Tabs<ActivityState>
          value={state}
          onChange={setState}
          tabs={STATES.map((s) => ({
            key: s,
            label: t(`state_${s}`),
            count: s === 'overdue' ? overdue.length : s === 'today' ? todayList.length : undefined,
          }))}
        />
        <Checkbox label={t('allSalespeople')} checked={everyone} onChange={setEveryone} />
      </div>
      {isLoading ? <div className="text-gray-500">{tc('loading')}</div> : <ActivityTable activities={data} labelFor={related} />}
      <ActivityFormModal isOpen={open} onClose={() => setOpen(false)} leadOptions={leads.map((l) => ({ value: l.id, label: `${l.leadNumber} - ${l.title}` }))} />
    </div>
  );
}
