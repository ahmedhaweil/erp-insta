'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import StatCard from '@/components/ui/StatCard';
import { Button, Card, Field, Input, Select, SimpleTable, Toolbar, td, useMoney } from '@/components/people/ui';
import { useLocalName, usePeopleQuery, useUsers } from '@/hooks/use-people';
import { crmService, type PipelineBucket } from '@/services/people-crm.service';
import { Target, TrendingUp, Trophy, XCircle } from 'lucide-react';

export default function PipelineReportPage() {
  const t = useTranslations('crm');
  const tc = useTranslations('common');
  const name = useLocalName();
  const money = useMoney();
  const { data: users = [] } = useUsers();
  const [filters, setFilters] = useState({ from: '', to: '', assignedUserId: '' });
  const [applied, setApplied] = useState(filters);
  const { data, isLoading } = usePeopleQuery(['crm-pipeline-report', applied], () => crmService.pipelineReport(applied));
  const rate = (v: number | null) => (v === null ? '-' : `${v}%`);
  const cells = (b: PipelineBucket) => (
    <>
      <td className={td}>{b.openCount}</td>
      <td className={td}>{money(b.pipelineValue)}</td>
      <td className={td}>{money(b.weightedValue)}</td>
      <td className={td}>{b.wonCount}</td>
      <td className={td}>{money(b.wonValue)}</td>
      <td className={td}>{b.lostCount}</td>
      <td className={td}>{rate(b.winRate)}</td>
    </>
  );
  const headers = [t('openCount'), t('pipelineValue'), t('weightedValue'), t('wonCount'), t('wonValue'), t('lostCount'), t('winRate')];
  const maxWeighted = Math.max(1, ...(data?.byStage ?? []).map((s) => s.pipelineValue));

  return (
    <div className="space-y-4">
      <PageHeader title={t('pipelineReport')} />
      <Toolbar>
        <Field label={t('createdFrom')}>
          <Input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} />
        </Field>
        <Field label={t('createdTo')}>
          <Input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} />
        </Field>
        <Field label={t('salesperson')}>
          <Select value={filters.assignedUserId} onChange={(e) => setFilters((f) => ({ ...f, assignedUserId: e.target.value }))} placeholder={tc('all')} options={users.map((u) => ({ value: u.id, label: u.name ?? u.id }))} />
        </Field>
        <Button onClick={() => setApplied(filters)}>{t('apply')}</Button>
      </Toolbar>
      {isLoading || !data ? (
        <div className="text-gray-500">{tc('loading')}</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <StatCard title={t('pipelineValue')} value={money(data.summary.pipelineValue)} icon={<Target size={22} />} />
            <StatCard title={t('weightedValue')} value={money(data.summary.weightedValue)} icon={<TrendingUp size={22} />} color="yellow" />
            <StatCard title={t('wonValue')} value={money(data.summary.wonValue)} icon={<Trophy size={22} />} color="green" />
            <StatCard title={t('winRate')} value={rate(data.summary.winRate)} icon={<XCircle size={22} />} color="red" />
          </div>
          <Card title={t('byStage')}>
            <div className="space-y-2 mb-4">
              {data.byStage.map((s) => (
                <div key={s.stageId} className="flex items-center gap-3 text-sm">
                  <span className="w-32 truncate">{name(s)}</span>
                  <div className="flex-1 bg-gray-100 rounded h-5 relative overflow-hidden">
                    <div className="bg-primary-200 h-5 absolute inset-y-0 start-0" style={{ width: `${(s.pipelineValue / maxWeighted) * 100}%` }} />
                    <div className="bg-primary-500 h-5 absolute inset-y-0 start-0" style={{ width: `${(s.weightedValue / maxWeighted) * 100}%` }} />
                  </div>
                  <span className="w-32 text-end tabular-nums">{money(s.pipelineValue)}</span>
                </div>
              ))}
            </div>
            <SimpleTable headers={[t('stage'), t('probability'), ...headers]}>
              {data.byStage.map((s) => (
                <tr key={s.stageId}>
                  <td className={td}>{name(s)}</td>
                  <td className={td}>{s.probability}%</td>
                  {cells(s)}
                </tr>
              ))}
            </SimpleTable>
          </Card>
          <Card title={t('bySalesperson')}>
            <SimpleTable headers={[t('salesperson'), ...headers]}>
              {data.bySalesperson.map((s) => (
                <tr key={s.userId ?? 'none'}>
                  <td className={td}>{s.userId ? s.name : t('unassigned')}</td>
                  {cells(s)}
                </tr>
              ))}
            </SimpleTable>
          </Card>
          <Card title={t('lostReasons')}>
            <SimpleTable headers={[t('lostReason'), t('count')]}>
              {data.lostReasons.map((r) => (
                <tr key={r.reason}>
                  <td className={td}>{r.reason === 'Unspecified' ? t('unspecified') : r.reason}</td>
                  <td className={td}>{r.count}</td>
                </tr>
              ))}
            </SimpleTable>
          </Card>
        </>
      )}
    </div>
  );
}
