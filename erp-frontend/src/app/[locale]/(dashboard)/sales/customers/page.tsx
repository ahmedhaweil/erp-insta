'use client';

import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { EntityForm, type FieldDef, toOptions } from '@/components/operations/form';
import { byId, fmtMoney, num, RowAction, RowActions, Status, useModal, useNamer } from '@/components/operations/common';
import { useOpsCustomerCategories, useOpsCustomers, useOpsMutation, useOpsPriceLists, useOpsReps } from '@/hooks/use-operations';
import { opsSales } from '@/services/operations-sales.service';
import type { Row } from '@/services/operations-api';
import { PrintButton } from '@/components/platform/PrintButton';

export default function CustomersPage() {
  const t = useTranslations('ops');
  const tPl = useTranslations('platform');
  const name = useNamer();
  const { data: customers = [], isLoading } = useOpsCustomers();
  const { data: categories = [] } = useOpsCustomerCategories();
  const { data: priceLists = [] } = useOpsPriceLists();
  const { data: reps = [] } = useOpsReps();
  const catMap = byId(categories);
  const plMap = byId(priceLists);
  const repMap = byId(reps);
  const form = useModal<Row>();
  const del = useModal<Row>();

  const save = useOpsMutation(
    (body: any) => (form.data ? opsSales.updateCustomer(form.data.id, body) : opsSales.createCustomer(body)),
    { invalidate: ['customers'], onSuccess: () => form.close() },
  );
  const remove = useOpsMutation((id: string) => opsSales.deleteCustomer(id), { invalidate: ['customers'], success: 'deleted', onSuccess: () => del.close() });

  const fields: FieldDef[] = [
    { name: 'code', label: t('common.code'), required: true },
    { name: 'phone', label: t('common.phone'), required: true },
    { name: 'nameAr', label: t('common.nameAr'), required: true },
    { name: 'nameEn', label: t('common.nameEn'), required: true },
    { name: 'email', label: t('common.email'), type: 'email' },
    { name: 'taxId', label: t('common.taxId') },
    { name: 'categoryId', label: t('sales.customerCategory'), type: 'select', options: toOptions(categories, name) },
    { name: 'priceListId', label: t('sales.priceList'), type: 'select', options: priceLists.map((p) => ({ value: p.id, label: p.name })), hint: t('sales.priceListHint') },
    { name: 'salesRepId', label: t('sales.salesRep'), type: 'select', options: reps.map((r) => ({ value: r.id, label: `${r.code} - ${r.name}` })) },
    { name: 'creditLimit', label: t('sales.creditLimit'), type: 'number', min: 0, hint: t('sales.creditLimitHint') },
    { name: 'paymentTermDays', label: t('sales.paymentTermDays'), type: 'number', min: 0, step: '1' },
    { name: 'city', label: t('common.city') },
    { name: 'country', label: t('common.country') },
    { name: 'isActive', label: t('common.active'), type: 'checkbox' },
    { name: 'address', label: t('common.address'), wide: true },
  ];

  const submit = (p: any) => {
    if (p.paymentTermDays != null) p.paymentTermDays = Math.round(p.paymentTermDays);
    save.mutate(p);
  };

  return (
    <div>
      <PageHeader title={t('sales.customers')} action={{ label: t('sales.newCustomer'), onClick: () => form.open() }} />
      <DataTable
        data={customers}
        loading={isLoading}
        searchable
        pageSize={20}
        columns={[
          { key: 'code', header: t('common.code') },
          { key: 'nameAr', header: t('common.name'), render: (c: Row) => name(c) },
          { key: 'phone', header: t('common.phone') },
          { key: 'categoryId', header: t('sales.customerCategory'), render: (c: Row) => (c.categoryId ? name(catMap[c.categoryId]) : '-') },
          { key: 'priceListId', header: t('sales.priceList'), render: (c: Row) => plMap[c.priceListId]?.name ?? '-' },
          { key: 'salesRepId', header: t('sales.salesRep'), render: (c: Row) => repMap[c.salesRepId]?.name ?? '-' },
          { key: 'creditLimit', header: t('sales.creditLimit'), render: (c: Row) => (num(c.creditLimit) ? fmtMoney(c.creditLimit) : t('sales.unlimited')) },
          { key: 'paymentTermDays', header: t('sales.paymentTermDays') },
          {
            key: 'balance',
            header: t('sales.balance'),
            render: (c: Row) => (
              <span className={num(c.creditLimit) && num(c.balance) > num(c.creditLimit) ? 'text-red-600 font-medium' : ''}>{fmtMoney(c.balance)}</span>
            ),
          },
          { key: 'isActive', header: t('common.status'), render: (c: Row) => <Status status={c.isActive ? 'active' : 'inactive'} /> },
        ]}
        actions={(c: Row) => (
          <RowActions>
            <RowAction onClick={() => form.open(c)}>{t('common.edit')}</RowAction>
            <PrintButton path={`/print/statements/customer/${c.id}`} label={tPl('print.statement')} />
            <RowAction tone="red" onClick={() => del.open(c)}>{t('common.delete')}</RowAction>
          </RowActions>
        )}
      />
      <Modal isOpen={form.isOpen} onClose={form.close} title={form.data ? t('sales.editCustomer') : t('sales.newCustomer')} size="xl">
        <EntityForm
          key={form.data?.id ?? 'new'}
          fields={fields}
          mode={form.data ? 'edit' : 'create'}
          initial={form.data ?? { isActive: true, paymentTermDays: 0 }}
          loading={save.isPending}
          onSubmit={submit}
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
