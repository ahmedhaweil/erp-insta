'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { Btn, Field, inputCls, SelectBox, toOptions } from '@/components/operations/form';
import { byId, Card, FilterBar, fmtDateTime, fmtMoney, fmtQty, num, SimpleTable, Stat, Tabs, useModal, useNamer } from '@/components/operations/common';
import Pager from '@/components/operations/Pager';
import LotsInput, { type LotDraft, lotsPayload } from '@/components/operations/LotsInput';
import { useOpsCategories, useOpsMutation, useOpsProducts, useOpsQuery, useOpsWarehouses } from '@/hooks/use-operations';
import { opsInventory } from '@/services/operations-inventory.service';
import type { Row } from '@/services/operations-api';

type Tab = 'balance' | 'movements';

/** Stock balance per warehouse, stock movements, adjustments and manual receipts. */
export default function StockPage() {
  const t = useTranslations('ops');
  const name = useNamer();
  const [tab, setTab] = useState<Tab>('balance');
  const [warehouseId, setWarehouseId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [productId, setProductId] = useState('');
  const [includeZero, setIncludeZero] = useState(false);
  const [moveFrom, setMoveFrom] = useState('');
  const [moveTo, setMoveTo] = useState('');
  const [offset, setOffset] = useState(0);
  const MOVE_LIMIT = 100;
  const { data: warehouses = [] } = useOpsWarehouses();
  const { data: categories = [] } = useOpsCategories();
  const { data: products = [] } = useOpsProducts();
  const productMap = byId(products);
  const whMap = byId(warehouses);

  const balance = useOpsQuery(['stock-balance', warehouseId, categoryId, includeZero], () =>
    opsInventory.stockBalance({ warehouseId, categoryId, includeZero: includeZero || undefined }),
  );
  const movements = useOpsQuery(
    ['stock-movements', warehouseId, productId, moveFrom, moveTo, offset],
    () => opsInventory.movements({ warehouseId, productId, from: moveFrom, to: moveTo, limit: MOVE_LIMIT, offset }),
    {
      enabled: tab === 'movements',
    },
  );
  const moveModal = useModal<'adjust' | 'receive'>();

  const groups: any[] = balance.data?.warehouses ?? [];

  return (
    <div>
      <PageHeader title={t('inv.stock')} />
      <div className="flex flex-wrap gap-2 mb-4">
        <Btn onClick={() => moveModal.open('adjust')}>{t('inv.adjustStock')}</Btn>
        <Btn variant="success" onClick={() => moveModal.open('receive')}>{t('inv.receiveStock')}</Btn>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'balance', label: t('inv.stockBalance') },
          { key: 'movements', label: t('inv.stockMovements') },
        ]}
      />
      <FilterBar>
        <Field label={t('common.warehouse')}>
          <SelectBox value={warehouseId} onChange={setWarehouseId} options={toOptions(warehouses, name)} emptyLabel={t('common.all')} />
        </Field>
        {tab === 'balance' ? (
          <>
            <Field label={t('inv.category')}>
              <SelectBox value={categoryId} onChange={setCategoryId} options={toOptions(categories, name, false)} emptyLabel={t('common.all')} />
            </Field>
            <label className="flex items-center gap-2 text-sm pb-2">
              <input type="checkbox" checked={includeZero} onChange={(e) => setIncludeZero(e.target.checked)} />
              {t('inv.includeZero')}
            </label>
          </>
        ) : (
          <>
            <Field label={t('common.product')}>
              <SelectBox
                value={productId}
                onChange={(v) => {
                  setProductId(v);
                  setOffset(0);
                }}
                options={toOptions(products, name)}
                emptyLabel={t('common.all')}
              />
            </Field>
            <Field label={t('common.from')}>
              <input
                type="date"
                className={inputCls}
                value={moveFrom}
                onChange={(e) => {
                  setMoveFrom(e.target.value);
                  setOffset(0);
                }}
              />
            </Field>
            <Field label={t('common.to')}>
              <input
                type="date"
                className={inputCls}
                value={moveTo}
                onChange={(e) => {
                  setMoveTo(e.target.value);
                  setOffset(0);
                }}
              />
            </Field>
          </>
        )}
      </FilterBar>

      {tab === 'balance' ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label={t('inv.totalValue')} value={fmtMoney(balance.data?.totalValue)} />
            <Stat label={t('inv.warehouseCount')} value={groups.length} />
          </div>
          {balance.isLoading && <p className="text-sm text-gray-500">{t('common.loading')}</p>}
          {!balance.isLoading && groups.length === 0 && <Card><p className="text-sm text-gray-500">{t('common.noData')}</p></Card>}
          {groups.map((g) => (
            <Card key={g.warehouseId} title={`${g.warehouseCode} - ${g.warehouseName}`} actions={<span className="text-sm text-gray-600">{t('inv.totalValue')}: {fmtMoney(g.totalValue)}</span>}>
              <SimpleTable
                rows={g.lines}
                columns={[
                  { key: 'productCode', header: t('common.code') },
                  { key: 'productName', header: t('common.product'), render: (l) => (productMap[l.productId] ? name(productMap[l.productId]) : l.productName) },
                  { key: 'quantity', header: t('inv.onHand'), render: (l) => <span className={num(l.quantity) < 0 ? 'text-red-600' : ''}>{fmtQty(l.quantity)}</span> },
                  { key: 'reservedQty', header: t('inv.reserved'), render: (l) => fmtQty(l.reservedQty) },
                  { key: 'availableQty', header: t('inv.available'), render: (l) => fmtQty(l.availableQty) },
                  { key: 'unitCost', header: t('inv.avgCost'), render: (l) => fmtMoney(l.unitCost) },
                  { key: 'value', header: t('inv.value'), render: (l) => fmtMoney(l.value) },
                ]}
              />
            </Card>
          ))}
        </div>
      ) : (
        <>
        <DataTable
          data={movements.data ?? []}
          loading={movements.isLoading}
          searchable
          pageSize={MOVE_LIMIT}
          columns={[
            { key: 'createdAt', header: t('common.date'), render: (m: Row) => fmtDateTime(m.createdAt) },
            { key: 'productId', header: t('common.product'), render: (m: Row) => name(m.product ?? productMap[m.productId]) },
            { key: 'warehouseId', header: t('common.warehouse'), render: (m: Row) => name(m.warehouse ?? whMap[m.warehouseId]) },
            { key: 'type', header: t('common.type'), render: (m: Row) => (t.has(`inv.moveTypes.${m.type}`) ? t(`inv.moveTypes.${m.type}`) : m.type) },
            { key: 'quantity', header: t('common.quantity'), render: (m: Row) => fmtQty(m.quantity) },
            { key: 'unitCost', header: t('inv.unitCost'), render: (m: Row) => fmtMoney(m.unitCost) },
            { key: 'referenceType', header: t('inv.reference'), render: (m: Row) => m.referenceType || '-' },
          ]}
        />
        <Pager offset={offset} limit={MOVE_LIMIT} count={movements.data?.length ?? 0} onChange={setOffset} />
        </>
      )}

      {moveModal.data && (
        <StockMoveModal
          mode={moveModal.data}
          products={products}
          warehouses={warehouses}
          onClose={moveModal.close}
        />
      )}
    </div>
  );
}

function StockMoveModal({
  mode,
  products,
  warehouses,
  onClose,
}: {
  mode: 'adjust' | 'receive';
  products: Row[];
  warehouses: Row[];
  onClose: () => void;
}) {
  const t = useTranslations('ops');
  const name = useNamer();
  const [productId, setProductId] = useState('');
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '');
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [reason, setReason] = useState('');
  const [lots, setLots] = useState<LotDraft[]>([]);
  const product = products.find((p) => p.id === productId);
  const tracked = product && product.trackingType && product.trackingType !== 'none';

  const save = useOpsMutation(
    () => {
      const body: any = { productId, warehouseId, quantity: num(quantity), reason: reason || undefined };
      const l = lotsPayload(lots);
      if (l.length) body.lots = l;
      if (mode === 'receive') {
        if (unitCost !== '') body.unitCost = num(unitCost);
        return opsInventory.receive(body);
      }
      return opsInventory.adjust(body);
    },
    { invalidate: ['stock-balance', 'stock-movements', 'lots'], onSuccess: onClose },
  );

  return (
    <Modal isOpen onClose={onClose} title={mode === 'adjust' ? t('inv.adjustStock') : t('inv.receiveStock')} size="lg">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label={t('common.product')} required>
            <SelectBox value={productId} onChange={setProductId} required options={toOptions(products.filter((p) => p.type !== 'service'), name)} />
          </Field>
          <Field label={t('common.warehouse')} required>
            <SelectBox value={warehouseId} onChange={setWarehouseId} required options={toOptions(warehouses, name)} />
          </Field>
          <Field label={t('common.quantity')} required hint={mode === 'adjust' ? t('inv.adjustHint') : undefined}>
            <input type="number" step="any" required value={quantity} onChange={(e) => setQuantity(e.target.value)} className={inputCls} />
          </Field>
          {mode === 'receive' && (
            <Field label={t('inv.unitCost')}>
              <input type="number" step="any" min="0" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} className={inputCls} />
            </Field>
          )}
          <Field label={t('inv.reason')} className="md:col-span-2">
            <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} />
          </Field>
        </div>
        {tracked && (
          <Field label={product.trackingType === 'serial' ? t('inv.serials') : t('inv.lots')} hint={t('inv.lotsHint')}>
            <LotsInput lots={lots} onChange={setLots} showExpiry={!!product.hasExpiry} />
          </Field>
        )}
        <div className="flex justify-end gap-2">
          <Btn variant="secondary" onClick={onClose}>{t('common.cancel')}</Btn>
          <Btn type="submit" loading={save.isPending}>{t('common.save')}</Btn>
        </div>
      </form>
    </Modal>
  );
}
