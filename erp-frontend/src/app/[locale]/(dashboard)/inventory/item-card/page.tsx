'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import { Btn, Field, inputCls, SelectBox, toOptions } from '@/components/operations/form';
import { Card, FilterBar, fmtDateTime, fmtMoney, fmtQty, SimpleTable, Stat, useNamer } from '@/components/operations/common';
import { useOpsProducts, useOpsQuery, useOpsWarehouses } from '@/hooks/use-operations';
import { opsInventory } from '@/services/operations-inventory.service';

/** Item card (كارت الصنف): running quantity and value of one product. */
export default function ItemCardPage() {
  const t = useTranslations('ops');
  const name = useNamer();
  const { data: products = [] } = useOpsProducts();
  const { data: warehouses = [] } = useOpsWarehouses();
  const [filters, setFilters] = useState({ productId: '', warehouseId: '', from: '', to: '' });
  const [applied, setApplied] = useState<typeof filters | null>(null);
  const card = useOpsQuery(['item-card', applied], () => opsInventory.itemCard(applied!), { enabled: !!applied?.productId });
  const d = card.data;

  return (
    <div>
      <PageHeader title={t('inv.itemCard')} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (filters.productId) setApplied({ ...filters });
        }}
      >
        <FilterBar>
          <Field label={t('common.product')} required>
            <SelectBox value={filters.productId} onChange={(v) => setFilters({ ...filters, productId: v })} required options={toOptions(products.filter((p) => p.type !== 'service'), name)} />
          </Field>
          <Field label={t('common.warehouse')}>
            <SelectBox value={filters.warehouseId} onChange={(v) => setFilters({ ...filters, warehouseId: v })} emptyLabel={t('common.all')} options={toOptions(warehouses, name)} />
          </Field>
          <Field label={t('common.from')}>
            <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} className={inputCls} />
          </Field>
          <Field label={t('common.to')}>
            <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} className={inputCls} />
          </Field>
          <Btn type="submit">{t('common.show')}</Btn>
        </FilterBar>
      </form>
      {card.isLoading && applied && <p className="text-sm text-gray-500">{t('common.loading')}</p>}
      {d && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat label={t('common.product')} value={`${d.product?.code} - ${d.product?.name}`} />
            <Stat label={t('inv.openingBalance')} value={`${fmtQty(d.opening?.quantity)} / ${fmtMoney(d.opening?.value)}`} />
            <Stat label={t('inv.totalIn')} value={fmtQty(d.totals?.inQty)} tone="green" />
            <Stat label={t('inv.totalOut')} value={fmtQty(d.totals?.outQty)} tone="red" />
            <Stat label={t('inv.closingBalance')} value={`${fmtQty(d.closing?.quantity)} / ${fmtMoney(d.closing?.value)}`} />
          </div>
          <Card title={`${t('inv.period')}: ${d.from} - ${d.to}`}>
            <SimpleTable
              rows={d.lines ?? []}
              columns={[
                { key: 'date', header: t('common.date'), render: (l) => fmtDateTime(l.date) },
                { key: 'type', header: t('common.type'), render: (l) => (t.has(`inv.moveTypes.${l.type}`) ? t(`inv.moveTypes.${l.type}`) : l.type) },
                { key: 'referenceType', header: t('inv.reference'), render: (l) => l.referenceType || '-' },
                { key: 'warehouseName', header: t('common.warehouse') },
                { key: 'inQty', header: t('inv.in'), render: (l) => (l.inQty ? fmtQty(l.inQty) : '') },
                { key: 'outQty', header: t('inv.out'), render: (l) => (l.outQty ? fmtQty(l.outQty) : '') },
                { key: 'unitCost', header: t('inv.unitCost'), render: (l) => fmtMoney(l.unitCost) },
                { key: 'balanceQty', header: t('inv.balanceQty'), render: (l) => fmtQty(l.balanceQty) },
                { key: 'balanceValue', header: t('inv.balanceValue'), render: (l) => fmtMoney(l.balanceValue) },
                { key: 'averageCost', header: t('inv.avgCost'), render: (l) => fmtMoney(l.averageCost) },
              ]}
            />
          </Card>
        </div>
      )}
    </div>
  );
}
