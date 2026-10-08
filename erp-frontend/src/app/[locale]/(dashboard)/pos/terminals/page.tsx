'use client';

import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { EntityForm, toOptions, type FieldDef } from '@/components/operations/form';
import { byId, num, RowAction, Status, useModal, useNamer } from '@/components/operations/common';
import { useOpsBranches, useOpsMutation, useOpsTerminals, useOpsWarehouses } from '@/hooks/use-operations';
import { opsPos } from '@/services/operations-pos.service';
import type { Row } from '@/services/operations-api';

export default function PosTerminalsPage() {
  const t = useTranslations('ops');
  const name = useNamer();
  const { data: terminals = [], isLoading } = useOpsTerminals();
  const { data: branches = [] } = useOpsBranches();
  const { data: warehouses = [] } = useOpsWarehouses();
  const branchMap = byId(branches);
  const whMap = byId(warehouses);
  const form = useModal<Row>();
  const save = useOpsMutation((body: any) => (form.data ? opsPos.updateTerminal(form.data.id, body) : opsPos.createTerminal(body)), {
    invalidate: ['terminals'],
    onSuccess: () => form.close(),
  });
  const fields: FieldDef[] = [
    { name: 'name', label: t('common.name'), required: true },
    { name: 'branchId', label: t('common.branch'), type: 'select', required: true, options: toOptions(branches, name) },
    { name: 'warehouseId', label: t('common.warehouse'), type: 'select', options: toOptions(warehouses, name), hint: t('pos.terminalWarehouseHint') },
    { name: 'maxDiscountPercent', label: t('pos.maxDiscount'), type: 'number', min: 0, max: 100, hint: t('pos.maxDiscountHint') },
    { name: 'printerIp', label: t('pos.printerIp') },
    { name: 'cashDrawerPort', label: t('pos.cashDrawerPort') },
    { name: 'scalePort', label: t('pos.scalePort') },
    { name: 'isActive', label: t('common.active'), type: 'checkbox' },
  ];
  return (
    <div>
      <PageHeader title={t('pos.terminals')} action={{ label: t('pos.newTerminal'), onClick: () => form.open() }} />
      <DataTable
        data={terminals}
        loading={isLoading}
        searchable
        columns={[
          { key: 'name', header: t('common.name') },
          { key: 'branchId', header: t('common.branch'), render: (x: Row) => name(branchMap[x.branchId]) },
          { key: 'warehouseId', header: t('common.warehouse'), render: (x: Row) => (x.warehouseId ? name(whMap[x.warehouseId]) : '-') },
          { key: 'maxDiscountPercent', header: t('pos.maxDiscount'), render: (x: Row) => (x.maxDiscountPercent != null ? `${num(x.maxDiscountPercent)}%` : t('pos.noLimit')) },
          { key: 'printerIp', header: t('pos.printerIp') },
          { key: 'isActive', header: t('common.status'), render: (x: Row) => <Status status={x.isActive ? 'active' : 'inactive'} /> },
        ]}
        actions={(x: Row) => <RowAction onClick={() => form.open(x)}>{t('common.edit')}</RowAction>}
      />
      <Modal isOpen={form.isOpen} onClose={form.close} title={form.data ? t('pos.editTerminal') : t('pos.newTerminal')} size="lg">
        <EntityForm
          key={form.data?.id ?? 'new'}
          fields={fields}
          mode={form.data ? 'edit' : 'create'}
          initial={form.data ?? { isActive: true, branchId: branches[0]?.id }}
          loading={save.isPending}
          onSubmit={(p) => save.mutate(p)}
          onCancel={form.close}
        />
      </Modal>
    </div>
  );
}
