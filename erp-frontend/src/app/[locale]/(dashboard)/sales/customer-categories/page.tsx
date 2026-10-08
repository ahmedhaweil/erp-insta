'use client';

import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { EntityForm, type FieldDef } from '@/components/operations/form';
import { byId, RowAction, Status, useModal, useNamer } from '@/components/operations/common';
import { useOpsCustomerCategories, useOpsMutation, useOpsPriceLists } from '@/hooks/use-operations';
import { opsSales } from '@/services/operations-sales.service';
import type { Row } from '@/services/operations-api';

export default function CustomerCategoriesPage() {
  const t = useTranslations('ops');
  const name = useNamer();
  const { data: categories = [], isLoading } = useOpsCustomerCategories();
  const { data: priceLists = [] } = useOpsPriceLists();
  const plMap = byId(priceLists);
  const form = useModal<Row>();
  const save = useOpsMutation(
    (body: any) => (form.data ? opsSales.updateCustomerCategory(form.data.id, body) : opsSales.createCustomerCategory(body)),
    { invalidate: ['customer-categories'], onSuccess: () => form.close() },
  );
  const fields: FieldDef[] = [
    { name: 'code', label: t('common.code'), required: true },
    { name: 'priceListId', label: t('sales.priceList'), type: 'select', options: priceLists.map((p) => ({ value: p.id, label: p.name })) },
    { name: 'nameAr', label: t('common.nameAr'), required: true },
    { name: 'nameEn', label: t('common.nameEn') },
    { name: 'isActive', label: t('common.active'), type: 'checkbox' },
  ];
  return (
    <div>
      <PageHeader title={t('sales.customerCategories')} action={{ label: t('sales.newCustomerCategory'), onClick: () => form.open() }} />
      <DataTable
        data={categories}
        loading={isLoading}
        searchable
        columns={[
          { key: 'code', header: t('common.code') },
          { key: 'nameAr', header: t('common.name'), render: (c: Row) => name(c) },
          { key: 'priceListId', header: t('sales.priceList'), render: (c: Row) => plMap[c.priceListId]?.name ?? '-' },
          { key: 'isActive', header: t('common.status'), render: (c: Row) => <Status status={c.isActive ? 'active' : 'inactive'} /> },
        ]}
        actions={(c: Row) => <RowAction onClick={() => form.open(c)}>{t('common.edit')}</RowAction>}
      />
      <Modal isOpen={form.isOpen} onClose={form.close} title={form.data ? t('sales.editCustomerCategory') : t('sales.newCustomerCategory')}>
        <EntityForm
          key={form.data?.id ?? 'new'}
          fields={fields}
          mode={form.data ? 'edit' : 'create'}
          initial={form.data ?? { isActive: true }}
          loading={save.isPending}
          onSubmit={(p) => save.mutate(p)}
          onCancel={form.close}
        />
      </Modal>
    </div>
  );
}
