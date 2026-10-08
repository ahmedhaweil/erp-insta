'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { EntityForm, Field, SelectBox, toOptions, type FieldDef } from '@/components/operations/form';
import { byId, FilterBar, fmtDate, fmtMoney, Status, today, useModal, useNamer } from '@/components/operations/common';
import { useOpsCategories, useOpsMutation, useOpsQuery, useOpsWarehouses } from '@/hooks/use-operations';
import { opsInventory } from '@/services/operations-inventory.service';
import type { Row } from '@/services/operations-api';

export default function StockCountsPage() {
  const t = useTranslations('ops');
  const name = useNamer();
  const router = useRouter();
  const [status, setStatus] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const { data: warehouses = [] } = useOpsWarehouses();
  const { data: categories = [] } = useOpsCategories();
  const whMap = byId(warehouses);
  const { data: counts = [], isLoading } = useOpsQuery(['stock-counts', status, warehouseId], () => opsInventory.counts({ status, warehouseId }));
  const modal = useModal();

  const create = useOpsMutation((body: any) => opsInventory.createCount(body), {
    invalidate: ['stock-counts'],
    onSuccess: (count: Row) => router.push(`/inventory/stock-counts/${count.id}`),
  });

  const fields: FieldDef[] = [
    { name: 'warehouseId', label: t('common.warehouse'), type: 'select', required: true, options: toOptions(warehouses, name) },
    { name: 'categoryId', label: t('inv.category'), type: 'select', emptyLabel: t('common.all'), options: toOptions(categories, name, false) },
    { name: 'date', label: t('common.date'), type: 'date' },
    { name: 'includeAllProducts', label: t('inv.includeAllProducts'), type: 'checkbox' },
    { name: 'notes', label: t('common.notes'), type: 'textarea', wide: true },
  ];

  return (
    <div>
      <PageHeader title={t('inv.stockCounts')} action={{ label: t('inv.newCount'), onClick: () => modal.open() }} />
      <FilterBar>
        <Field label={t('common.status')}>
          <SelectBox value={status} onChange={setStatus} emptyLabel={t('common.all')} options={['open', 'validated', 'cancelled'].map((s) => ({ value: s, label: t(`status.${s}`) }))} />
        </Field>
        <Field label={t('common.warehouse')}>
          <SelectBox value={warehouseId} onChange={setWarehouseId} emptyLabel={t('common.all')} options={toOptions(warehouses, name)} />
        </Field>
      </FilterBar>
      <DataTable
        data={counts}
        loading={isLoading}
        searchable
        onRowClick={(c: Row) => router.push(`/inventory/stock-counts/${c.id}`)}
        columns={[
          { key: 'countNumber', header: t('common.number') },
          { key: 'date', header: t('common.date'), render: (c: Row) => fmtDate(c.date) },
          { key: 'warehouseId', header: t('common.warehouse'), render: (c: Row) => name(c.warehouse ?? whMap[c.warehouseId]) },
          { key: 'differenceValue', header: t('inv.differenceValue'), render: (c: Row) => fmtMoney(c.differenceValue) },
          { key: 'status', header: t('common.status'), render: (c: Row) => <Status status={c.status} /> },
        ]}
      />
      <Modal isOpen={modal.isOpen} onClose={modal.close} title={t('inv.newCount')}>
        <EntityForm
          fields={fields}
          initial={{ date: today(), warehouseId: warehouses[0]?.id }}
          loading={create.isPending}
          onSubmit={(p) => create.mutate(p)}
          onCancel={modal.close}
        />
      </Modal>
    </div>
  );
}
