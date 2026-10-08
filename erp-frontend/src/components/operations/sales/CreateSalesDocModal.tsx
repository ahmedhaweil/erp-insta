'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Modal from '@/components/ui/Modal';
import { EntityForm, toOptions, type FieldDef } from '@/components/operations/form';
import { today, useNamer } from '@/components/operations/common';
import LinesEditor, { type DocLine, linesPayload, newLine } from '@/components/operations/LinesEditor';
import { useOpsCustomers, useOpsMutation, useOpsPriceLists, useOpsProducts, useOpsReps, useOpsWarehouses } from '@/hooks/use-operations';
import { opsSales } from '@/services/operations-sales.service';

/** Create a quotation (kind=order) or a direct customer invoice (kind=invoice). */
export default function CreateSalesDocModal({ kind, onClose }: { kind: 'order' | 'invoice'; onClose: () => void }) {
  const t = useTranslations('ops');
  const name = useNamer();
  const { data: customers = [] } = useOpsCustomers();
  const { data: products = [] } = useOpsProducts();
  const { data: warehouses = [] } = useOpsWarehouses();
  const { data: reps = [] } = useOpsReps();
  const { data: priceLists = [] } = useOpsPriceLists();
  const [lines, setLines] = useState<DocLine[]>([newLine()]);
  const save = useOpsMutation(
    (body: any) => (kind === 'order' ? opsSales.createOrder(body) : opsSales.createInvoice(body)),
    { invalidate: ['sales-orders', 'sales-invoices'], onSuccess: onClose },
  );

  const fields: FieldDef[] = [
    { name: 'customerId', label: t('common.customer'), type: 'select', required: true, options: toOptions(customers, name) },
    { name: 'date', label: t('common.date'), type: 'date', required: true },
    kind === 'order'
      ? { name: 'validityDate', label: t('sales.validityDate'), type: 'date' }
      : { name: 'dueDate', label: t('common.dueDate'), type: 'date', hint: t('sales.dueDateHint') },
    ...(kind === 'order'
      ? [{ name: 'warehouseId', label: t('common.warehouse'), type: 'select' as const, options: toOptions(warehouses, name) }]
      : [{ name: 'withholdingRate', label: t('common.withholdingRate'), type: 'number' as const, min: 0, max: 100 }]),
    { name: 'salesRepId', label: t('sales.salesRep'), type: 'select', emptyLabel: t('sales.fromCustomer'), options: reps.map((r) => ({ value: r.id, label: `${r.code} - ${r.name}` })) },
    { name: 'priceListId', label: t('sales.priceList'), type: 'select', emptyLabel: t('sales.fromCustomer'), options: priceLists.map((p) => ({ value: p.id, label: p.name })) },
    { name: 'notes', label: t('common.notes'), wide: true },
    { name: 'pricesIncludeTax', label: t('common.pricesIncludeTax'), type: 'checkbox' },
  ];

  return (
    <Modal isOpen onClose={onClose} title={kind === 'order' ? t('sales.newQuotation') : t('sales.newInvoice')} size="xl">
      <EntityForm
        fields={fields}
        columns={3}
        initial={{ date: today(), warehouseId: warehouses[0]?.id }}
        loading={save.isPending}
        onCancel={onClose}
        onSubmit={(header) => {
          const payload = linesPayload(lines);
          if (!payload.length) return;
          save.mutate({ ...header, lines: payload });
        }}
      >
        <LinesEditor lines={lines} onChange={setLines} products={products} priceField="sellPrice" taxField="salesTaxRate" priceHint={t('sales.priceAutoHint')} />
      </EntityForm>
    </Modal>
  );
}
