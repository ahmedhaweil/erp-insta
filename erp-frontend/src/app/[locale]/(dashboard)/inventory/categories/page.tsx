'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { EntityForm, type FieldDef, toOptions } from '@/components/operations/form';
import { byId, fmtQty, Status, Tabs, useModal, useNamer } from '@/components/operations/common';
import { useOpsCategories, useOpsMutation, useOpsUnits } from '@/hooks/use-operations';
import { opsInventory } from '@/services/operations-inventory.service';
import type { Row } from '@/services/operations-api';

type Tab = 'categories' | 'units';

/** Product categories and units of measure (master data). */
export default function CategoriesUnitsPage() {
  const t = useTranslations('ops');
  const name = useNamer();
  const [tab, setTab] = useState<Tab>('categories');
  const { data: categories = [], isLoading: loadingCats } = useOpsCategories();
  const { data: units = [], isLoading: loadingUnits } = useOpsUnits();
  const catMap = byId(categories);
  const unitMap = byId(units);
  const modal = useModal();

  const createCategory = useOpsMutation((body: any) => opsInventory.createCategory(body), {
    invalidate: ['categories'],
    onSuccess: () => modal.close(),
  });
  const createUnit = useOpsMutation((body: any) => opsInventory.createUnit(body), {
    invalidate: ['units'],
    onSuccess: () => modal.close(),
  });

  const categoryFields: FieldDef[] = [
    { name: 'nameAr', label: t('common.nameAr'), required: true },
    { name: 'nameEn', label: t('common.nameEn') },
    { name: 'parentId', label: t('inv.parentCategory'), type: 'select', options: toOptions(categories, name, false) },
    { name: 'isActive', label: t('common.active'), type: 'checkbox' },
  ];
  const unitFields: FieldDef[] = [
    { name: 'nameAr', label: t('common.nameAr'), required: true },
    { name: 'nameEn', label: t('common.nameEn') },
    { name: 'symbol', label: t('inv.symbol'), required: true },
    { name: 'baseUnitId', label: t('inv.referenceUnit'), type: 'select', options: toOptions(units, name, false) },
    { name: 'conversionFactor', label: t('inv.conversionFactor'), type: 'number', min: 0.000001, hint: t('inv.conversionFactorHint') },
  ];

  const isCats = tab === 'categories';

  return (
    <div>
      <PageHeader
        title={t('inv.categoriesUnits')}
        action={{ label: isCats ? t('inv.newCategory') : t('inv.newUnit'), onClick: () => modal.open() }}
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'categories', label: t('inv.categories') },
          { key: 'units', label: t('inv.units') },
        ]}
      />
      {isCats ? (
        <DataTable
          data={categories}
          loading={loadingCats}
          searchable
          columns={[
            { key: 'nameAr', header: t('common.name'), render: (c: Row) => name(c) },
            { key: 'parentId', header: t('inv.parentCategory'), render: (c: Row) => (c.parentId ? name(catMap[c.parentId]) : '-') },
            { key: 'level', header: t('inv.level') },
            { key: 'isActive', header: t('common.status'), render: (c: Row) => <Status status={c.isActive ? 'active' : 'inactive'} /> },
          ]}
        />
      ) : (
        <DataTable
          data={units}
          loading={loadingUnits}
          searchable
          columns={[
            { key: 'nameAr', header: t('common.name'), render: (u: Row) => name(u) },
            { key: 'symbol', header: t('inv.symbol') },
            { key: 'baseUnitId', header: t('inv.referenceUnit'), render: (u: Row) => (u.baseUnitId ? name(unitMap[u.baseUnitId]) : '-') },
            { key: 'conversionFactor', header: t('inv.conversionFactor'), render: (u: Row) => fmtQty(u.conversionFactor) },
          ]}
        />
      )}
      <Modal isOpen={modal.isOpen} onClose={modal.close} title={isCats ? t('inv.newCategory') : t('inv.newUnit')}>
        {isCats ? (
          <EntityForm
            fields={categoryFields}
            initial={{ isActive: true }}
            loading={createCategory.isPending}
            onSubmit={(p) => createCategory.mutate(p)}
            onCancel={modal.close}
          />
        ) : (
          <EntityForm fields={unitFields} loading={createUnit.isPending} onSubmit={(p) => createUnit.mutate(p)} onCancel={modal.close} />
        )}
      </Modal>
    </div>
  );
}
