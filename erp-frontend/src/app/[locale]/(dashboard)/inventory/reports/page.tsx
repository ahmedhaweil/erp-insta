'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import { Field, inputCls, inputSm, SelectBox, toOptions } from '@/components/operations/form';
import { byId, Card, FilterBar, fmtDate, fmtMoney, fmtQty, num, SimpleTable, Stat, Tabs, useNamer } from '@/components/operations/common';
import { useOpsProducts, useOpsQuery, useOpsSuppliers, useOpsWarehouses } from '@/hooks/use-operations';
import { opsInventory } from '@/services/operations-inventory.service';

type Tab = 'slow' | 'negative' | 'reorder';

/** Slow-moving, negative stock and reorder reports. */
export default function InventoryReportsPage() {
  const t = useTranslations('ops');
  const name = useNamer();
  const [tab, setTab] = useState<Tab>('slow');
  const [warehouseId, setWarehouseId] = useState('');
  const [days, setDays] = useState('90');
  const { data: warehouses = [] } = useOpsWarehouses();
  const { data: products = [] } = useOpsProducts();
  const { data: suppliers = [] } = useOpsSuppliers();
  const productMap = byId(products);
  const whMap = byId(warehouses);
  const supMap = byId(suppliers);

  const slow = useOpsQuery(['inv-report', 'slow', warehouseId, days], () => opsInventory.slowMoving({ warehouseId, days: num(days) || 90 }), {
    enabled: tab === 'slow',
  });
  const negative = useOpsQuery(['inv-report', 'negative', warehouseId], () => opsInventory.negativeStock({ warehouseId }), {
    enabled: tab === 'negative',
  });
  const reorder = useOpsQuery(['inv-report', 'reorder', warehouseId], () => opsInventory.reorder({ warehouseId }), {
    enabled: tab === 'reorder',
  });
  const pname = (id: string, fallback?: string) => (productMap[id] ? name(productMap[id]) : fallback ?? '-');

  return (
    <div>
      <PageHeader title={t('inv.reports')} />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'slow', label: t('inv.slowMoving') },
          { key: 'negative', label: t('inv.negativeStock') },
          { key: 'reorder', label: t('inv.reorderReport') },
        ]}
      />
      <FilterBar>
        <Field label={t('common.warehouse')}>
          <SelectBox value={warehouseId} onChange={setWarehouseId} emptyLabel={t('common.all')} options={toOptions(warehouses, name)} />
        </Field>
        {tab === 'slow' && (
          <Field label={t('inv.noIssueDays')}>
            <input type="number" min="1" value={days} onChange={(e) => setDays(e.target.value)} className={`${inputSm} w-28`} />
          </Field>
        )}
      </FilterBar>

      {tab === 'slow' && (
        <div className="space-y-3">
          <Stat label={t('inv.totalValue')} value={fmtMoney(slow.data?.totalValue)} tone="amber" />
          <SimpleTable
            rows={slow.data?.lines ?? []}
            columns={[
              { key: 'productCode', header: t('common.code') },
              { key: 'productName', header: t('common.product'), render: (l) => pname(l.productId, l.productName) },
              { key: 'warehouseName', header: t('common.warehouse'), render: (l) => (whMap[l.warehouseId] ? name(whMap[l.warehouseId]) : l.warehouseName) },
              { key: 'quantity', header: t('inv.onHand'), render: (l) => fmtQty(l.quantity) },
              { key: 'value', header: t('inv.value'), render: (l) => fmtMoney(l.value) },
              { key: 'issuedQty', header: t('inv.issuedQty'), render: (l) => fmtQty(l.issuedQty) },
              { key: 'lastIssueAt', header: t('inv.lastIssue'), render: (l) => fmtDate(l.lastIssueAt) },
              { key: 'daysSinceLastIssue', header: t('inv.daysSinceIssue'), render: (l) => l.daysSinceLastIssue ?? (l.noMovement ? t('inv.never') : '-') },
            ]}
          />
        </div>
      )}

      {tab === 'negative' && (
        <div className="space-y-4">
          <Card title={t('inv.negativeBalances')}>
            <SimpleTable
              rows={negative.data?.negatives ?? []}
              columns={[
                { key: 'productCode', header: t('common.code') },
                { key: 'productName', header: t('common.product'), render: (l) => pname(l.productId, l.productName) },
                { key: 'warehouseName', header: t('common.warehouse'), render: (l) => (whMap[l.warehouseId] ? name(whMap[l.warehouseId]) : l.warehouseName) },
                { key: 'quantity', header: t('common.quantity'), render: (l) => <span className="text-red-600">{fmtQty(l.quantity)}</span> },
                { key: 'value', header: t('inv.value'), render: (l) => fmtMoney(l.value) },
              ]}
            />
          </Card>
          <Card title={t('inv.lotMismatches')}>
            <SimpleTable
              rows={negative.data?.lotMismatches ?? []}
              columns={[
                { key: 'productId', header: t('common.product'), render: (l) => pname(l.productId) },
                { key: 'warehouseId', header: t('common.warehouse'), render: (l) => name(whMap[l.warehouseId]) },
                { key: 'lotQty', header: t('inv.lotQty'), render: (l) => fmtQty(l.lotQty) },
                { key: 'stockQty', header: t('inv.stockQty'), render: (l) => fmtQty(l.stockQty) },
              ]}
            />
          </Card>
        </div>
      )}

      {tab === 'reorder' && (
        <SimpleTable
          rows={reorder.data?.lines ?? []}
          columns={[
            { key: 'productCode', header: t('common.code') },
            { key: 'productName', header: t('common.product'), render: (l) => pname(l.productId, l.productName) },
            { key: 'onHand', header: t('inv.onHand'), render: (l) => fmtQty(l.onHand) },
            { key: 'reserved', header: t('inv.reserved'), render: (l) => fmtQty(l.reserved) },
            { key: 'available', header: t('inv.available'), render: (l) => fmtQty(l.available) },
            { key: 'reorderLevel', header: t('inv.reorderLevel'), render: (l) => fmtQty(l.reorderLevel) },
            { key: 'suggestedQty', header: t('inv.suggestedQty'), render: (l) => <strong>{fmtQty(l.suggestedQty)}</strong> },
            { key: 'estimatedCost', header: t('inv.estimatedCost'), render: (l) => fmtMoney(l.estimatedCost) },
            { key: 'preferredSupplierId', header: t('inv.preferredSupplier'), render: (l) => (l.preferredSupplierId ? name(supMap[l.preferredSupplierId]) : '-') },
          ]}
        />
      )}
    </div>
  );
}
