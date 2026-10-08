'use client';

import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { EntityForm, type FieldDef, toOptions } from '@/components/operations/form';
import { byId, RowAction, Status, useModal, useNamer } from '@/components/operations/common';
import { useOpsBranches, useOpsMutation, useOpsWarehouses } from '@/hooks/use-operations';
import { opsInventory } from '@/services/operations-inventory.service';
import type { Row } from '@/services/operations-api';

export default function WarehousesPage() {
  const t = useTranslations('ops');
  const name = useNamer();
  const { data: warehouses = [], isLoading } = useOpsWarehouses();
  const { data: branches = [] } = useOpsBranches();
  const branchMap = byId(branches);
  const modal = useModal<Row>();

  const save = useOpsMutation(
    (body: any) => (modal.data ? opsInventory.updateWarehouse(modal.data.id, body) : opsInventory.createWarehouse(body)),
    { invalidate: ['warehouses'], onSuccess: () => modal.close() },
  );

  const fields: FieldDef[] = [
    { name: 'code', label: t('common.code'), required: true },
    { name: 'branchId', label: t('common.branch'), type: 'select', required: true, options: toOptions(branches, name) },
    { name: 'nameAr', label: t('common.nameAr'), required: true },
    { name: 'nameEn', label: t('common.nameEn') },
    { name: 'address', label: t('common.address'), wide: true },
    { name: 'isActive', label: t('common.active'), type: 'checkbox' },
  ];

  return (
    <div>
      <PageHeader title={t('inv.warehouses')} action={{ label: t('inv.newWarehouse'), onClick: () => modal.open() }} />
      <DataTable
        data={warehouses}
        loading={isLoading}
        searchable
        columns={[
          { key: 'code', header: t('common.code') },
          { key: 'nameAr', header: t('common.name'), render: (w: Row) => name(w) },
          { key: 'branchId', header: t('common.branch'), render: (w: Row) => name(branchMap[w.branchId]) },
          { key: 'address', header: t('common.address') },
          { key: 'isActive', header: t('common.status'), render: (w: Row) => <Status status={w.isActive ? 'active' : 'inactive'} /> },
        ]}
        actions={(w: Row) => <RowAction onClick={() => modal.open(w)}>{t('common.edit')}</RowAction>}
      />
      <Modal isOpen={modal.isOpen} onClose={modal.close} title={modal.data ? t('inv.editWarehouse') : t('inv.newWarehouse')}>
        <EntityForm
          key={modal.data?.id ?? 'new'}
          fields={fields}
          mode={modal.data ? 'edit' : 'create'}
          initial={modal.data ?? { isActive: true, branchId: branches[0]?.id }}
          loading={save.isPending}
          onSubmit={(p) => save.mutate(p)}
          onCancel={modal.close}
        />
      </Modal>
    </div>
  );
}
