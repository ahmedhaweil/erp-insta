'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import { Button, Card, Checkbox, ErrorBox, Field, Input, Select, SimpleTable, Toolbar, num, td, useMoney } from '@/components/people/ui';
import { apiErrorMessage, useLabelMap, usePeopleQuery, useProducts, useWarehouses } from '@/hooks/use-people';
import { mfgService } from '@/services/people-manufacturing.service';

export default function RequirementsPage() {
  const t = useTranslations('mfg');
  const tc = useTranslations('common');
  const tp = useTranslations('people');
  const money = useMoney();
  const { data: boms = [] } = usePeopleQuery(['mfg-boms', 'all'], () => mfgService.boms());
  const { data: products } = useProducts();
  const { data: warehouses } = useWarehouses();
  const labels = useLabelMap(products);
  const whMap = useLabelMap(warehouses);
  const [form, setForm] = useState({ bomId: '', quantity: '1', warehouseId: '', explode: true });
  const [applied, setApplied] = useState<typeof form | null>(null);
  const { data, isLoading, error } = usePeopleQuery(
    ['mfg-requirements', applied],
    () => mfgService.requirements({ bomId: applied!.bomId, quantity: Number(applied!.quantity), warehouseId: applied!.warehouseId || undefined, explode: applied!.explode }),
    !!applied?.bomId,
  );

  return (
    <div className="space-y-4">
      <PageHeader title={t('requirements')} />
      <Toolbar>
        <Field label={t('bom')}>
          <Select
            value={form.bomId}
            onChange={(e) => setForm((f) => ({ ...f, bomId: e.target.value }))}
            placeholder={tp('select')}
            options={boms.map((b) => ({ value: b.id, label: `${b.code} v${b.version} - ${labels.get(b.productId) ?? ''}${b.isActive ? '' : ` (${tc('inactive')})`}` }))}
          />
        </Field>
        <Field label={tc('quantity')}>
          <Input type="number" step="any" min="0.0001" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} className="w-32" />
        </Field>
        <Field label={t('warehouse')}>
          <Select value={form.warehouseId} onChange={(e) => setForm((f) => ({ ...f, warehouseId: e.target.value }))} placeholder={tc('all')} options={[...whMap].map(([value, label]) => ({ value, label }))} />
        </Field>
        <Checkbox label={t('multiLevel')} checked={form.explode} onChange={(v) => setForm((f) => ({ ...f, explode: v }))} />
        <Button disabled={!form.bomId} onClick={() => setApplied({ ...form })}>{t('plan')}</Button>
      </Toolbar>
      {error && <ErrorBox message={apiErrorMessage(error, tc('error'))} />}
      {applied && isLoading && <div className="text-gray-500">{tc('loading')}</div>}
      {data && (
        <>
          <Card>
            <div className="flex flex-wrap gap-6 text-sm">
              <div>
                <div className="text-gray-500">{t('canProduce')}</div>
                <div className={`font-bold ${data.canProduce ? 'text-green-700' : 'text-red-700'}`}>{data.canProduce ? tc('yes') : tc('no')}</div>
              </div>
              <div><div className="text-gray-500">{t('shortageItems')}</div><div className="font-semibold">{data.shortages.length}</div></div>
              <div><div className="text-gray-500">{t('estimatedPurchaseCost')}</div><div className="font-semibold">{money(data.estimatedPurchaseCost)}</div></div>
              <div><div className="text-gray-500">{t('labour')}</div><div className="font-semibold">{money(data.labourCost)}</div></div>
              <div><div className="text-gray-500">{t('overhead')}</div><div className="font-semibold">{money(data.overheadCost)}</div></div>
            </div>
          </Card>
          <SimpleTable headers={[tc('code'), t('product'), t('level'), t('required'), t('onHand'), t('available'), t('openDemand'), t('netAvailable'), t('shortage'), t('toBuy'), t('unitCost'), t('estimatedCost')]}>
            {data.lines.map((l) => (
              <tr key={l.productId} className={l.shortage > 0 ? 'bg-red-50' : undefined}>
                <td className={td}>{l.productCode}</td>
                <td className={td}>{l.productName}{!l.stockable && <span className="text-xs text-gray-400 ms-1">({t('notStockable')})</span>}</td>
                <td className={td}>{l.level}</td>
                <td className={td}>{num(l.required)}</td>
                <td className={td}>{num(l.onHand)}</td>
                <td className={td}>{num(l.available)}</td>
                <td className={td}>{num(l.openOrderDemand)}</td>
                <td className={td}>{num(l.netAvailable)}</td>
                <td className={`${td} ${l.shortage > 0 ? 'text-red-700 font-semibold' : ''}`}>{num(l.shortage)}</td>
                <td className={td}>{num(l.toBuy)}</td>
                <td className={td}>{money(l.unitCost, 4)}</td>
                <td className={td}>{money(l.estimatedCost)}</td>
              </tr>
            ))}
          </SimpleTable>
        </>
      )}
    </div>
  );
}
