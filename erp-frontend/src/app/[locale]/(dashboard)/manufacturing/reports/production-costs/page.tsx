'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import { Button, Field, Input, SimpleTable, Toolbar, num, td, useMoney } from '@/components/people/ui';
import { usePeopleQuery } from '@/hooks/use-people';
import { mfgService } from '@/services/people-manufacturing.service';

const COLORS: Record<string, string> = { confirmed: 'confirmed', in_progress: 'pending', done: 'completed' };

export default function ProductionCostsPage() {
  const t = useTranslations('mfg');
  const tc = useTranslations('common');
  const router = useRouter();
  const money = useMoney();
  const [range, setRange] = useState({ from: '', to: '' });
  const [applied, setApplied] = useState(range);
  const { data, isLoading } = usePeopleQuery(['mfg-production-costs', applied], () => mfgService.productionCosts(applied));

  return (
    <div className="space-y-4">
      <PageHeader title={t('productionCosts')} />
      <Toolbar>
        <Field label={t('from')}>
          <Input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
        </Field>
        <Field label={t('to')}>
          <Input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
        </Field>
        <Button onClick={() => setApplied(range)}>{t('apply')}</Button>
      </Toolbar>
      {isLoading || !data ? (
        <div className="text-gray-500">{tc('loading')}</div>
      ) : (
        <SimpleTable
          headers={[t('orderNumber'), t('product'), tc('status'), t('planned'), t('produced'), t('standardUnitCost'), t('stdCost'), t('actCost'), t('actualUnitCost'), t('variance'), t('scrapCost')]}
          footer={
            <tr>
              <td className={td} colSpan={6}>{tc('total')}</td>
              <td className={td}>{money(data.totals.standardCost)}</td>
              <td className={td}>{money(data.totals.actualCost)}</td>
              <td />
              <td className={td}>{money(data.totals.variance)}</td>
              <td className={td}>{money(data.totals.scrapCost)}</td>
            </tr>
          }
        >
          {data.rows.map((r) => (
            <tr key={r.orderId} className="cursor-pointer hover:bg-gray-50" onClick={() => router.push(`/manufacturing/production-orders/${r.orderId}`)}>
              <td className={td}>{r.orderNumber}</td>
              <td className={td}>{r.productName}</td>
              <td className={td}><StatusBadge status={COLORS[r.status] ?? r.status} label={t(`status_${r.status}`)} /></td>
              <td className={td}>{num(r.plannedQuantity)}</td>
              <td className={td}>{num(r.producedQuantity)}</td>
              <td className={td}>{money(r.standardUnitCost, 4)}</td>
              <td className={td}>{money(r.standardCost)}</td>
              <td className={td}>{money(r.actualCost)}</td>
              <td className={td}>{money(r.actualUnitCost, 4)}</td>
              <td className={`${td} ${r.variance > 0 ? 'text-red-700' : r.variance < 0 ? 'text-green-700' : ''}`}>{money(r.variance)}</td>
              <td className={td}>{money(r.scrapCost)}</td>
            </tr>
          ))}
        </SimpleTable>
      )}
    </div>
  );
}
