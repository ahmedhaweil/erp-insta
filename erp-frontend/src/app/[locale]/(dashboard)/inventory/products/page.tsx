'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { EntityForm, type FieldDef, toOptions, Field, inputCls, Btn, SelectBox } from '@/components/operations/form';
import { byId, fmtMoney, fmtQty, num, RowAction, RowActions, SimpleTable, Status, useModal, useNamer } from '@/components/operations/common';
import {
  useOpsCategories,
  useOpsMutation,
  useOpsProducts,
  useOpsQuery,
  useOpsSuppliers,
  useOpsUnits,
} from '@/hooks/use-operations';
import { opsInventory } from '@/services/operations-inventory.service';
import type { Row } from '@/services/operations-api';
import ExportMenu from '@/components/platform/ExportMenu';

export default function ProductsPage() {
  const t = useTranslations('ops');
  const name = useNamer();
  const { data: products = [], isLoading } = useOpsProducts();
  const { data: categories = [] } = useOpsCategories();
  const { data: units = [] } = useOpsUnits();
  const { data: suppliers = [] } = useOpsSuppliers();
  const catMap = byId(categories);
  const unitMap = byId(units);

  const form = useModal<Row>();
  const unitsModal = useModal<Row>();
  const del = useModal<Row>();

  const save = useOpsMutation(
    (payload: any) => (form.data ? opsInventory.updateProduct(form.data.id, payload) : opsInventory.createProduct(payload)),
    { invalidate: ['products'], onSuccess: () => form.close() },
  );
  const remove = useOpsMutation((id: string) => opsInventory.deleteProduct(id), {
    invalidate: ['products'],
    success: 'deleted',
    onSuccess: () => del.close(),
  });

  const fields: FieldDef[] = [
    { name: 'code', label: t('common.code'), required: true },
    { name: 'barcode', label: t('inv.barcode') },
    { name: 'nameAr', label: t('common.nameAr'), required: true },
    { name: 'nameEn', label: t('common.nameEn') },
    {
      name: 'type',
      label: t('inv.productType'),
      type: 'select',
      required: true,
      options: [
        { value: 'goods', label: t('inv.types.goods') },
        { value: 'service', label: t('inv.types.service') },
      ],
    },
    { name: 'sku', label: t('inv.sku') },
    { name: 'categoryId', label: t('inv.category'), type: 'select', required: true, options: toOptions(categories, name, false) },
    { name: 'unitId', label: t('inv.baseUnit'), type: 'select', required: true, options: toOptions(units, (u) => `${name(u)} (${u.symbol})`, false) },
    { name: 'costPrice', label: t('inv.costPrice'), type: 'number', min: 0 },
    { name: 'sellPrice', label: t('inv.sellPrice'), type: 'number', min: 0 },
    { name: 'minSellPrice', label: t('inv.minSellPrice'), type: 'number', min: 0, hint: t('inv.minSellPriceHint') },
    { name: 'salesTaxRate', label: t('inv.salesTaxRate'), type: 'number', min: 0, max: 100 },
    { name: 'purchaseTaxRate', label: t('inv.purchaseTaxRate'), type: 'number', min: 0, max: 100 },
    {
      name: 'trackingType',
      label: t('inv.trackingType'),
      type: 'select',
      emptyLabel: t('inv.tracking.none'),
      options: [
        { value: 'lot', label: t('inv.tracking.lot') },
        { value: 'serial', label: t('inv.tracking.serial') },
      ],
    },
    { name: 'reorderLevel', label: t('inv.reorderLevel'), type: 'number', min: 0 },
    { name: 'reorderQty', label: t('inv.reorderQty'), type: 'number', min: 0 },
    { name: 'preferredSupplierId', label: t('inv.preferredSupplier'), type: 'select', options: toOptions(suppliers, name) },
    { name: 'hasExpiry', label: t('inv.hasExpiry'), type: 'checkbox' },
    { name: 'isActive', label: t('common.active'), type: 'checkbox' },
    { name: 'description', label: t('common.description'), type: 'textarea', wide: true },
  ];

  const submit = (payload: any) => {
    // trackingType has no empty value on the API: "none" is the default.
    const body = { ...payload, trackingType: payload.trackingType || 'none' };
    save.mutate(body);
  };

  const columns = [
    { key: 'code', header: t('common.code') },
    { key: 'nameAr', header: t('common.name'), render: (p: Row) => name(p) },
    { key: 'barcode', header: t('inv.barcode') },
    { key: 'categoryId', header: t('inv.category'), render: (p: Row) => name(p.category ?? catMap[p.categoryId]) },
    { key: 'unitId', header: t('common.unit'), render: (p: Row) => name(p.unit ?? unitMap[p.unitId]) },
    { key: 'trackingType', header: t('inv.trackingType'), render: (p: Row) => t(`inv.tracking.${p.trackingType || 'none'}`) + (p.hasExpiry ? ` / ${t('inv.expiryShort')}` : '') },
    { key: 'sellPrice', header: t('inv.sellPrice'), render: (p: Row) => fmtMoney(p.sellPrice) },
    { key: 'minSellPrice', header: t('inv.minSellPrice'), render: (p: Row) => (p.minSellPrice != null ? fmtMoney(p.minSellPrice) : '-') },
    { key: 'salesTaxRate', header: t('inv.salesTaxRate'), render: (p: Row) => `${num(p.salesTaxRate)}%` },
    { key: 'isActive', header: t('common.status'), render: (p: Row) => <Status status={p.isActive ? 'active' : 'inactive'} /> },
  ];

  return (
    <div>
      <PageHeader title={t('inv.products')} action={{ label: t('inv.newProduct'), onClick: () => form.open() }} />
      <div className="flex justify-end -mt-3 mb-3">
        <ExportMenu entity="products" />
      </div>
      <DataTable
        columns={columns}
        data={products}
        loading={isLoading}
        searchable
        pageSize={20}
        actions={(p: Row) => (
          <RowActions>
            <RowAction onClick={() => form.open(p)}>{t('common.edit')}</RowAction>
            <RowAction tone="green" onClick={() => unitsModal.open(p)}>{t('inv.altUnits')}</RowAction>
            <RowAction tone="red" onClick={() => del.open(p)}>{t('common.delete')}</RowAction>
          </RowActions>
        )}
      />

      <Modal isOpen={form.isOpen} onClose={form.close} title={form.data ? t('inv.editProduct') : t('inv.newProduct')} size="xl">
        <EntityForm
          key={form.data?.id ?? 'new'}
          fields={fields}
          mode={form.data ? 'edit' : 'create'}
          initial={form.data ?? { type: 'goods', isActive: true, trackingType: '' }}
          loading={save.isPending}
          onSubmit={submit}
          onCancel={form.close}
        />
      </Modal>

      {unitsModal.data && (
        <ProductUnitsModal product={unitsModal.data} units={units} onClose={unitsModal.close} />
      )}

      <ConfirmDialog
        isOpen={del.isOpen}
        onClose={del.close}
        onConfirm={() => del.data && remove.mutate(del.data.id)}
        title={t('common.delete')}
        message={t('common.confirmDelete')}
        destructive
        loading={remove.isPending}
      />
    </div>
  );
}

function ProductUnitsModal({ product, units, onClose }: { product: Row; units: Row[]; onClose: () => void }) {
  const t = useTranslations('ops');
  const name = useNamer();
  const { data: rows = [], isLoading } = useOpsQuery(['product-units', product.id], () => opsInventory.productUnits(product.id));
  const [draft, setDraft] = useState({ unitId: '', factor: '', barcode: '', sellPrice: '' });

  const save = useOpsMutation(
    () =>
      opsInventory.upsertProductUnit(product.id, {
        unitId: draft.unitId,
        factor: num(draft.factor),
        barcode: draft.barcode || undefined,
        sellPrice: draft.sellPrice === '' ? undefined : num(draft.sellPrice),
      }),
    { invalidate: ['product-units'], onSuccess: () => setDraft({ unitId: '', factor: '', barcode: '', sellPrice: '' }) },
  );
  const remove = useOpsMutation((id: string) => opsInventory.deleteProductUnit(product.id, id), {
    invalidate: ['product-units'],
    success: 'deleted',
  });

  const pickUnit = (unitId: string) => {
    const u = units.find((x) => x.id === unitId);
    setDraft((d) => ({ ...d, unitId, factor: d.factor || (u?.conversionFactor ? String(num(u.conversionFactor)) : '') }));
  };

  return (
    <Modal isOpen onClose={onClose} title={`${t('inv.altUnits')} - ${name(product)}`} size="xl">
      <p className="text-sm text-gray-600 mb-3">{t('inv.altUnitsHint')}</p>
      {isLoading ? (
        <p className="text-sm text-gray-500">{t('common.loading')}</p>
      ) : (
        <SimpleTable
          rows={rows}
          columns={[
            { key: 'unit', header: t('common.unit'), render: (r) => name(r.unit) },
            { key: 'factor', header: t('inv.factor'), render: (r) => fmtQty(r.factor) },
            { key: 'barcode', header: t('inv.barcode'), render: (r) => r.barcode || '-' },
            { key: 'sellPrice', header: t('inv.sellPrice'), render: (r) => (r.sellPrice != null ? fmtMoney(r.sellPrice) : '-') },
            {
              key: 'x',
              header: '',
              render: (r) => (
                <RowAction tone="red" onClick={() => remove.mutate(r.id)}>
                  {t('common.delete')}
                </RowAction>
              ),
            },
          ]}
        />
      )}
      <form
        className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end mt-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.unitId && num(draft.factor) > 0) save.mutate(undefined);
        }}
      >
        <Field label={t('common.unit')} required>
          <SelectBox
            value={draft.unitId}
            onChange={pickUnit}
            required
            options={units.filter((u) => u.id !== product.unitId).map((u) => ({ value: u.id, label: `${name(u)} (${u.symbol})` }))}
          />
        </Field>
        <Field label={t('inv.factor')} required>
          <input type="number" step="any" min="0.000001" required value={draft.factor} onChange={(e) => setDraft({ ...draft, factor: e.target.value })} className={inputCls} />
        </Field>
        <Field label={t('inv.barcode')}>
          <input value={draft.barcode} onChange={(e) => setDraft({ ...draft, barcode: e.target.value })} className={inputCls} />
        </Field>
        <Field label={t('inv.sellPrice')}>
          <input type="number" step="any" min="0" value={draft.sellPrice} onChange={(e) => setDraft({ ...draft, sellPrice: e.target.value })} className={inputCls} />
        </Field>
        <Btn type="submit" loading={save.isPending}>
          {t('common.add')}
        </Btn>
      </form>
    </Modal>
  );
}
