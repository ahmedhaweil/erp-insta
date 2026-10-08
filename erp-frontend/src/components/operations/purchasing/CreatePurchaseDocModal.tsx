'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Modal from '@/components/ui/Modal';
import { EntityForm, toOptions, type FieldDef } from '@/components/operations/form';
import { today, useNamer } from '@/components/operations/common';
import LinesEditor, { type DocLine, linesPayload, newLine } from '@/components/operations/LinesEditor';
import { useOpsMutation, useOpsProducts, useOpsSuppliers, useOpsWarehouses } from '@/hooks/use-operations';
import { opsPurchasing } from '@/services/operations-purchasing.service';

/** Create a request for quotation (kind=order) or a direct vendor bill (kind=bill). */
export default function CreatePurchaseDocModal({ kind, onClose }: { kind: 'order' | 'bill'; onClose: () => void }) {
  const t = useTranslations('ops');
  const name = useNamer();
  const { data: suppliers = [] } = useOpsSuppliers();
  const { data: products = [] } = useOpsProducts();
  const { data: warehouses = [] } = useOpsWarehouses();
  const [lines, setLines] = useState<DocLine[]>([newLine()]);
  const save = useOpsMutation((body: any) => (kind === 'order' ? opsPurchasing.createOrder(body) : opsPurchasing.createBill(body)), {
    invalidate: ['purchase-orders', 'bills'],
    onSuccess: onClose,
  });

  const fields: FieldDef[] = [
    { name: 'supplierId', label: t('common.supplier'), type: 'select', required: true, options: toOptions(suppliers, name) },
    { name: 'date', label: t('common.date'), type: 'date', required: true },
    ...(kind === 'order'
      ? ([
          { name: 'expectedDate', label: t('pur.expectedDate'), type: 'date' },
          { name: 'warehouseId', label: t('common.warehouse'), type: 'select', options: toOptions(warehouses, name) },
        ] as FieldDef[])
      : ([
          { name: 'dueDate', label: t('common.dueDate'), type: 'date' },
          { name: 'supplierReference', label: t('pur.supplierReference') },
          { name: 'withholdingRate', label: t('common.withholdingRate'), type: 'number', min: 0, max: 100 },
        ] as FieldDef[])),
    { name: 'notes', label: t('common.notes'), wide: true },
    { name: 'pricesIncludeTax', label: t('common.pricesIncludeTax'), type: 'checkbox' },
  ];

  return (
    <Modal isOpen onClose={onClose} title={kind === 'order' ? t('pur.newRfq') : t('pur.newBill')} size="xl">
      <EntityForm
        fields={fields}
        columns={3}
        initial={{ date: today(), warehouseId: warehouses[0]?.id }}
        loading={save.isPending}
        onCancel={onClose}
        onSubmit={(header) => {
          const payload = linesPayload(lines, { requirePrice: true });
          if (payload.length) save.mutate({ ...header, lines: payload });
        }}
      >
        <LinesEditor lines={lines} onChange={setLines} products={products} priceField="costPrice" taxField="purchaseTaxRate" />
      </EntityForm>
    </Modal>
  );
}
