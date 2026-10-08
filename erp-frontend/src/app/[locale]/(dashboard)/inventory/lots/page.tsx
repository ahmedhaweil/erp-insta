'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import { Btn, Field, inputCls, inputSm, SelectBox, toOptions } from '@/components/operations/form';
import { Card, FilterBar, fmtDate, fmtDateTime, fmtMoney, fmtQty, num, SimpleTable, Stat, Tabs, useNamer } from '@/components/operations/common';
import { useOpsProducts, useOpsQuery, useOpsWarehouses } from '@/hooks/use-operations';
import { opsInventory } from '@/services/operations-inventory.service';
import type { Row } from '@/services/operations-api';

type Tab = 'all' | 'expiring' | 'expired' | 'trace';

export default function LotsPage() {
  const t = useTranslations('ops');
  const name = useNamer();
  const [tab, setTab] = useState<Tab>('all');
  const [warehouseId, setWarehouseId] = useState('');
  const [productId, setProductId] = useState('');
  const [includeEmpty, setIncludeEmpty] = useState(false);
  const [days, setDays] = useState('30');
  const [traceProduct, setTraceProduct] = useState('');
  const [traceLot, setTraceLot] = useState('');
  const [traceKey, setTraceKey] = useState<{ productId: string; lot: string } | null>(null);
  const { data: warehouses = [] } = useOpsWarehouses();
  const { data: products = [] } = useOpsProducts();
  const tracked = products.filter((p) => p.trackingType && p.trackingType !== 'none');

  const all = useOpsQuery(['lots', 'all', warehouseId, productId, includeEmpty], () => opsInventory.lots({ warehouseId, productId, includeEmpty: includeEmpty || undefined }), {
    enabled: tab === 'all',
  });
  const expiring = useOpsQuery(['lots', 'expiring', warehouseId, days], () => opsInventory.expiringLots({ warehouseId, days: num(days) || 30 }), {
    enabled: tab === 'expiring',
  });
  const expired = useOpsQuery(['lots', 'expired', warehouseId], () => opsInventory.expiredLots({ warehouseId }), { enabled: tab === 'expired' });
  const trace = useOpsQuery(['lots', 'trace', traceKey?.productId, traceKey?.lot], () => opsInventory.traceLot(traceKey!.productId, traceKey!.lot), {
    enabled: tab === 'trace' && !!traceKey,
  });

  const lotColumns = [
    { key: 'productCode', header: t('common.code') },
    { key: 'productName', header: t('common.product') },
    { key: 'warehouseName', header: t('common.warehouse') },
    { key: 'lotNumber', header: t('inv.lotNumber') },
    { key: 'expiryDate', header: t('inv.expiryDate'), render: (l: Row) => fmtDate(l.expiryDate) },
    {
      key: 'daysToExpiry',
      header: t('inv.daysToExpiry'),
      render: (l: Row) =>
        l.daysToExpiry == null ? '-' : <span className={num(l.daysToExpiry) < 0 ? 'text-red-600' : num(l.daysToExpiry) <= 30 ? 'text-amber-600' : ''}>{l.daysToExpiry}</span>,
    },
    { key: 'quantity', header: t('common.quantity'), render: (l: Row) => fmtQty(l.quantity) },
    { key: 'value', header: t('inv.value'), render: (l: Row) => fmtMoney(l.value) },
  ];
  const withIds = (rows: any[] | undefined) => (rows ?? []).map((r, i) => ({ id: r.id ?? `${r.lotNumber}-${i}`, ...r }));

  return (
    <div>
      <PageHeader title={t('inv.lotsTitle')} />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'all', label: t('inv.allLots') },
          { key: 'expiring', label: t('inv.expiringLots') },
          { key: 'expired', label: t('inv.expiredLots') },
          { key: 'trace', label: t('inv.traceLot') },
        ]}
      />
      {tab !== 'trace' && (
        <FilterBar>
          <Field label={t('common.warehouse')}>
            <SelectBox value={warehouseId} onChange={setWarehouseId} emptyLabel={t('common.all')} options={toOptions(warehouses, name)} />
          </Field>
          {tab === 'all' && (
            <>
              <Field label={t('common.product')}>
                <SelectBox value={productId} onChange={setProductId} emptyLabel={t('common.all')} options={toOptions(tracked, name)} />
              </Field>
              <label className="flex items-center gap-2 text-sm pb-2">
                <input type="checkbox" checked={includeEmpty} onChange={(e) => setIncludeEmpty(e.target.checked)} />
                {t('inv.includeEmptyLots')}
              </label>
            </>
          )}
          {tab === 'expiring' && (
            <Field label={t('inv.withinDays')}>
              <input type="number" min="1" value={days} onChange={(e) => setDays(e.target.value)} className={`${inputSm} w-28`} />
            </Field>
          )}
        </FilterBar>
      )}

      {tab === 'all' && <DataTable data={withIds(all.data)} loading={all.isLoading} searchable pageSize={25} columns={lotColumns} />}
      {tab === 'expiring' && (
        <div className="space-y-3">
          <Stat label={t('inv.totalValue')} value={fmtMoney(expiring.data?.totalValue)} tone="amber" />
          <DataTable data={withIds(expiring.data?.lines)} loading={expiring.isLoading} searchable pageSize={25} columns={lotColumns} />
        </div>
      )}
      {tab === 'expired' && (
        <div className="space-y-3">
          <Stat label={t('inv.totalValue')} value={fmtMoney(expired.data?.totalValue)} tone="red" />
          <DataTable data={withIds(expired.data?.lines)} loading={expired.isLoading} searchable pageSize={25} columns={lotColumns} />
        </div>
      )}
      {tab === 'trace' && (
        <div className="space-y-4">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (traceProduct && traceLot.trim()) setTraceKey({ productId: traceProduct, lot: traceLot.trim() });
            }}
          >
            <Field label={t('common.product')} required>
              <SelectBox value={traceProduct} onChange={setTraceProduct} required options={toOptions(tracked, name)} />
            </Field>
            <Field label={t('inv.lotNumber')} required>
              <input value={traceLot} onChange={(e) => setTraceLot(e.target.value)} required className={inputCls} />
            </Field>
            <Btn type="submit">{t('inv.trace')}</Btn>
          </form>
          {trace.isLoading && traceKey && <p className="text-sm text-gray-500">{t('common.loading')}</p>}
          {trace.data && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label={t('inv.lotNumber')} value={trace.data.lotNumber} />
                <Stat label={t('inv.expiryDate')} value={fmtDate(trace.data.expiryDate)} />
                <Stat label={t('inv.onHand')} value={fmtQty(trace.data.totalOnHand)} />
                <Stat label={t('inv.origin')} value={trace.data.origin?.referenceType ?? '-'} />
              </div>
              <Card title={t('inv.balancesByWarehouse')}>
                <SimpleTable
                  rows={trace.data.balances ?? []}
                  columns={[
                    { key: 'warehouseName', header: t('common.warehouse') },
                    { key: 'quantity', header: t('common.quantity'), render: (b) => fmtQty(b.quantity) },
                  ]}
                />
              </Card>
              <Card title={t('inv.lotMovements')}>
                <SimpleTable
                  rows={trace.data.movements ?? []}
                  columns={[
                    { key: 'date', header: t('common.date'), render: (m) => fmtDateTime(m.date) },
                    { key: 'direction', header: t('inv.direction'), render: (m) => t(`inv.moveTypes.${m.direction === 'in' ? 'in' : 'out'}`) },
                    { key: 'quantity', header: t('common.quantity'), render: (m) => fmtQty(m.quantity) },
                    { key: 'referenceType', header: t('inv.reference'), render: (m) => m.referenceType || '-' },
                  ]}
                />
              </Card>
            </>
          )}
        </div>
      )}
    </div>
  );
}
