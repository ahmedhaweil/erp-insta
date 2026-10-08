'use client';

import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { EntityForm, type FieldDef } from '@/components/operations/form';
import { fmtMoney, RowAction, RowActions, Status, useModal, useNamer } from '@/components/operations/common';
import { useOpsMutation, useOpsSuppliers } from '@/hooks/use-operations';
import { opsPurchasing } from '@/services/operations-purchasing.service';
import type { Row } from '@/services/operations-api';
import { PrintButton } from '@/components/platform/PrintButton';
import ExportMenu from '@/components/platform/ExportMenu';

export default function SuppliersPage() {
  const t = useTranslations('ops');
  const tPl = useTranslations('platform');
  const name = useNamer();
  const { data: suppliers = [], isLoading } = useOpsSuppliers();
  const form = useModal<Row>();
  const del = useModal<Row>();
  const save = useOpsMutation(
    (body: any) => (form.data ? opsPurchasing.updateSupplier(form.data.id, body) : opsPurchasing.createSupplier(body)),
    { invalidate: ['suppliers'], onSuccess: () => form.close() },
  );
  const remove = useOpsMutation((id: string) => opsPurchasing.deleteSupplier(id), { invalidate: ['suppliers'], success: 'deleted', onSuccess: () => del.close() });

  const fields: FieldDef[] = [
    { name: 'code', label: t('common.code'), required: true },
    { name: 'phone', label: t('common.phone'), required: true },
    { name: 'nameAr', label: t('common.nameAr'), required: true },
    { name: 'nameEn', label: t('common.nameEn'), required: true },
    { name: 'email', label: t('common.email'), type: 'email' },
    { name: 'taxId', label: t('common.taxId') },
    { name: 'address', label: t('common.address'), required: true, wide: true },
    { name: 'city', label: t('common.city'), required: true },
    { name: 'country', label: t('common.country'), required: true },
    { name: 'creditLimit', label: t('sales.creditLimit'), type: 'number', min: 0 },
    { name: 'paymentTermDays', label: t('sales.paymentTermDays'), type: 'number', min: 0, step: '1' },
    { name: 'isActive', label: t('common.active'), type: 'checkbox' },
  ];

  return (
    <div>
      <PageHeader title={t('pur.suppliers')} action={{ label: t('pur.newSupplier'), onClick: () => form.open() }} />
      <div className="flex justify-end -mt-3 mb-3">
        <ExportMenu entity="suppliers" />
      </div>
      <DataTable
        data={suppliers}
        loading={isLoading}
        searchable
        pageSize={20}
        columns={[
          { key: 'code', header: t('common.code') },
          { key: 'nameAr', header: t('common.name'), render: (s: Row) => name(s) },
          { key: 'phone', header: t('common.phone') },
          { key: 'city', header: t('common.city') },
          { key: 'taxId', header: t('common.taxId') },
          { key: 'paymentTermDays', header: t('sales.paymentTermDays') },
          { key: 'balance', header: t('sales.balance'), render: (s: Row) => fmtMoney(s.balance) },
          { key: 'isActive', header: t('common.status'), render: (s: Row) => <Status status={s.isActive ? 'active' : 'inactive'} /> },
        ]}
        actions={(s: Row) => (
          <RowActions>
            <RowAction onClick={() => form.open(s)}>{t('common.edit')}</RowAction>
            <PrintButton path={`/print/statements/supplier/${s.id}`} label={tPl('print.statement')} />
            <RowAction tone="red" onClick={() => del.open(s)}>{t('common.delete')}</RowAction>
          </RowActions>
        )}
      />
      <Modal isOpen={form.isOpen} onClose={form.close} title={form.data ? t('pur.editSupplier') : t('pur.newSupplier')} size="xl">
        <EntityForm
          key={form.data?.id ?? 'new'}
          fields={fields}
          mode={form.data ? 'edit' : 'create'}
          initial={form.data ?? { isActive: true, country: 'EG', paymentTermDays: 0 }}
          loading={save.isPending}
          onSubmit={(p) => save.mutate({ ...p, ...(p.paymentTermDays != null ? { paymentTermDays: Math.round(p.paymentTermDays) } : {}) })}
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
