'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import { Field, Input, Select, Toolbar, useMoney } from '@/components/people/ui';
import { useCrmStages, useLocalName, usePeopleQuery, useUsers } from '@/hooks/use-people';
import { LEAD_SOURCES, crmService, type CrmLead } from '@/services/people-crm.service';

const LEAD_COLORS: Record<string, string> = { open: 'open', won: 'completed', lost: 'cancelled' };

export default function LeadsPage() {
  const t = useTranslations('crm');
  const tc = useTranslations('common');
  const router = useRouter();
  const name = useLocalName();
  const money = useMoney();
  const [filters, setFilters] = useState({ status: '', type: '', stageId: '', source: '', assignedUserId: '', search: '' });
  const { data = [], isLoading } = usePeopleQuery(['crm-leads', 'list', filters], () => crmService.leads(filters));
  const { data: stages = [] } = useCrmStages(true);
  const { data: users = [] } = useUsers();
  const userMap = new Map(users.map((u) => [u.id, u.name ?? u.email ?? '']));
  const set = (key: keyof typeof filters, value: string) => setFilters((f) => ({ ...f, [key]: value }));

  return (
    <div>
      <PageHeader title={t('leads')} action={{ label: t('newLead'), onClick: () => router.push('/crm/leads/new') }} />
      <Toolbar>
        <Field label={tc('search')}>
          <Input value={filters.search} onChange={(e) => set('search', e.target.value)} />
        </Field>
        <Field label={tc('status')}>
          <Select value={filters.status} onChange={(e) => set('status', e.target.value)} placeholder={tc('all')} options={['open', 'won', 'lost'].map((v) => ({ value: v, label: t(`status_${v}`) }))} />
        </Field>
        <Field label={t('type')}>
          <Select value={filters.type} onChange={(e) => set('type', e.target.value)} placeholder={tc('all')} options={['lead', 'opportunity'].map((v) => ({ value: v, label: t(`type_${v}`) }))} />
        </Field>
        <Field label={t('stage')}>
          <Select value={filters.stageId} onChange={(e) => set('stageId', e.target.value)} placeholder={tc('all')} options={stages.map((s) => ({ value: s.id, label: name(s) }))} />
        </Field>
        <Field label={t('source')}>
          <Select value={filters.source} onChange={(e) => set('source', e.target.value)} placeholder={tc('all')} options={LEAD_SOURCES.map((v) => ({ value: v, label: t(`source_${v}`) }))} />
        </Field>
        <Field label={t('salesperson')}>
          <Select value={filters.assignedUserId} onChange={(e) => set('assignedUserId', e.target.value)} placeholder={tc('all')} options={users.map((u) => ({ value: u.id, label: u.name ?? u.id }))} />
        </Field>
      </Toolbar>
      <DataTable<CrmLead>
        data={data}
        loading={isLoading}
        onRowClick={(l) => router.push(`/crm/leads/${l.id}`)}
        columns={[
          { key: 'leadNumber', header: t('leadNumber') },
          { key: 'title', header: t('leadTitle') },
          { key: 'type', header: t('type'), render: (l) => t(`type_${l.type}`) },
          { key: 'companyName', header: t('contact'), render: (l) => (l.customer ? name(l.customer) : l.companyName || l.contactName || '-') },
          { key: 'stageId', header: t('stage'), render: (l) => (l.stage ? name(l.stage) : '-') },
          { key: 'expectedRevenue', header: t('expectedRevenue'), render: (l) => money(l.expectedRevenue) },
          { key: 'probability', header: t('probability'), render: (l) => `${Number(l.probability)}%` },
          { key: 'assignedUserId', header: t('salesperson'), render: (l) => (l.assignedUserId ? userMap.get(l.assignedUserId) : '-') },
          { key: 'status', header: tc('status'), render: (l) => <StatusBadge status={LEAD_COLORS[l.status]} label={t(`status_${l.status}`)} /> },
        ]}
      />
    </div>
  );
}
