'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { EntityForm, toOptions, type FieldDef } from '@/components/operations/form';
import { byId, RowAction, RowActions, Stat, Tabs, useModal, useNamer } from '@/components/operations/common';
import { useOpsMutation, useOpsProducts, useOpsQuery } from '@/hooks/use-operations';
import { opsCompliance } from '@/services/operations-compliance.service';
import type { Row } from '@/services/operations-api';

const SUBTYPES = Array.from({ length: 10 }, (_, i) => `V0${String(i + 1).padStart(2, '0')}`);

/** ETA item codes (EGS / GS1) mapped to products. */
export default function ItemCodesPage() {
  const t = useTranslations('ops');
  const name = useNamer();
  const [tab, setTab] = useState<'mapped' | 'missing'>('mapped');
  const { data: codes = [], isLoading } = useOpsQuery(['item-codes'], opsCompliance.itemCodes);
  const { data: products = [] } = useOpsProducts();
  const productMap = byId(products);
  const mapped = new Set(codes.map((c) => c.productId));
  const missing = products.filter((p) => !mapped.has(p.id) && p.isActive !== false);
  const form = useModal<Row>();
  const del = useModal<Row>();

  const save = useOpsMutation(
    (body: any) => {
      if (form.data?.id && form.data.itemCode) {
        const { productId: _ignored, ...rest } = body;
        return opsCompliance.updateItemCode(form.data.id, rest);
      }
      return opsCompliance.createItemCode(body);
    },
    { invalidate: ['item-codes'], onSuccess: () => form.close() },
  );
  const remove = useOpsMutation((id: string) => opsCompliance.deleteItemCode(id), { invalidate: ['item-codes'], success: 'deleted', onSuccess: () => del.close() });
  const editing = !!form.data?.itemCode;

  const fields: FieldDef[] = [
    { name: 'productId', label: t('common.product'), type: 'select', required: true, hidden: editing, options: toOptions(editing ? products : missing, name), wide: true },
    { name: 'itemType', label: t('comp.itemType'), type: 'select', required: true, options: [{ value: 'EGS', label: 'EGS' }, { value: 'GS1', label: 'GS1' }] },
    { name: 'itemCode', label: t('comp.itemCode'), required: true, placeholder: 'EG-123456789-001' },
    { name: 'unitType', label: t('comp.unitType'), placeholder: 'EA' },
    { name: 'taxSubtype', label: t('comp.taxSubtype'), type: 'select', options: SUBTYPES.map((s) => ({ value: s, label: s })) },
    { name: 'description', label: t('common.description'), wide: true },
  ];

  return (
    <div>
      <PageHeader title={t('comp.itemCodes')} action={{ label: t('comp.newItemCode'), onClick: () => form.open() }} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Stat label={t('comp.mappedProducts')} value={codes.length} tone="green" />
        <Stat label={t('comp.unmappedProducts')} value={missing.length} tone={missing.length ? 'amber' : undefined} />
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'mapped', label: t('comp.mappedProducts') },
          { key: 'missing', label: t('comp.unmappedProducts') },
        ]}
      />
      {tab === 'mapped' ? (
        <DataTable
          data={codes}
          loading={isLoading}
          searchable
          pageSize={20}
          columns={[
            { key: 'productId', header: t('common.product'), render: (c: Row) => (productMap[c.productId] ? `${productMap[c.productId].code} - ${name(productMap[c.productId])}` : c.productId) },
            { key: 'itemType', header: t('comp.itemType') },
            { key: 'itemCode', header: t('comp.itemCode') },
            { key: 'unitType', header: t('comp.unitType') },
            { key: 'taxSubtype', header: t('comp.taxSubtype') },
          ]}
          actions={(c: Row) => (
            <RowActions>
              <RowAction onClick={() => form.open(c)}>{t('common.edit')}</RowAction>
              <RowAction tone="red" onClick={() => del.open(c)}>{t('common.delete')}</RowAction>
            </RowActions>
          )}
        />
      ) : (
        <DataTable
          data={missing}
          searchable
          pageSize={20}
          columns={[
            { key: 'code', header: t('common.code') },
            { key: 'nameAr', header: t('common.name'), render: (p: Row) => name(p) },
            { key: 'barcode', header: t('inv.barcode') },
          ]}
          actions={(p: Row) => <RowAction onClick={() => form.open({ id: '', productId: p.id, itemType: 'EGS' })}>{t('comp.assignCode')}</RowAction>}
        />
      )}
      <Modal isOpen={form.isOpen} onClose={form.close} title={editing ? t('comp.editItemCode') : t('comp.newItemCode')}>
        <EntityForm
          key={form.data?.id || form.data?.productId || 'new'}
          fields={fields}
          initial={form.data ?? { itemType: 'EGS' }}
          loading={save.isPending}
          onSubmit={(p) => save.mutate(p)}
          onCancel={form.close}
        />
      </Modal>
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
