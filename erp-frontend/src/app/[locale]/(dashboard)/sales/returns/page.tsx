'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { EntityForm, inputCls, inputSm, toOptions, type FieldDef } from '@/components/operations/form';
import {
  byId, DetailGrid, fmtDate, fmtMoney, fmtQty, num, RowAction, RowActions, SimpleTable, Status, Tabs, today, useModal, useNamer,
} from '@/components/operations/common';
import LinesEditor, { type DocLine, linesPayload, newLine } from '@/components/operations/LinesEditor';
import { useOpsCustomers, useOpsMutation, useOpsProducts, useOpsQuery, useOpsWarehouses } from '@/hooks/use-operations';
import { opsSales } from '@/services/operations-sales.service';
import type { Row } from '@/services/operations-api';

/** Sales returns: against an invoice (credit note / cash refund) or cash returns without invoice. */
export default function SalesReturnsPage() {
  const t = useTranslations('ops');
  const name = useNamer();
  const { data: returns = [], isLoading } = useOpsQuery(['sales-returns'], () => opsSales.returns());
  const { data: customers = [] } = useOpsCustomers();
  const customerMap = byId(customers);
  const create = useModal<string | null>();
  const detail = useModal<Row>();
  const { data: products = [] } = useOpsProducts();
  const productMap = byId(products);

  useEffect(() => {
    const invoiceId = new URLSearchParams(window.location.search).get('invoiceId');
    if (invoiceId) create.open(invoiceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const inv = ['sales-returns', 'sales-invoices', 'customers', 'stock-balance'];
  const post = useOpsMutation((id: string) => opsSales.postReturn(id), { invalidate: inv, success: 'posted' });
  const cancel = useOpsMutation((id: string) => opsSales.cancelReturn(id), { invalidate: inv, success: 'cancelled' });

  return (
    <div>
      <PageHeader title={t('sales.returns')} action={{ label: t('sales.newReturn'), onClick: () => create.open(null) }} />
      <DataTable
        data={returns}
        loading={isLoading}
        searchable
        pageSize={20}
        onRowClick={(r: Row) => detail.open(r)}
        columns={[
          { key: 'returnNumber', header: t('common.number') },
          { key: 'date', header: t('common.date'), render: (r: Row) => fmtDate(r.date) },
          { key: 'customerId', header: t('common.customer'), render: (r: Row) => name(r.customer ?? customerMap[r.customerId]) },
          { key: 'originalInvoiceId', header: t('sales.invoice'), render: (r: Row) => r.originalInvoice?.invoiceNumber ?? (r.originalInvoiceId ? t('common.yes') : '-') },
          { key: 'refundMethod', header: t('sales.refundMethod'), render: (r: Row) => t(`sales.refundMethods.${r.refundMethod}`) },
          { key: 'totalAmount', header: t('common.total'), render: (r: Row) => fmtMoney(r.totalAmount) },
          { key: 'status', header: t('common.status'), render: (r: Row) => <Status status={r.status} /> },
        ]}
        actions={(r: Row) => (
          <RowActions>
            {r.status === 'draft' && <RowAction tone="green" onClick={() => post.mutate(r.id)}>{t('sales.post')}</RowAction>}
            {r.status !== 'cancelled' && <RowAction tone="red" onClick={() => cancel.mutate(r.id)}>{t('common.cancel')}</RowAction>}
          </RowActions>
        )}
      />
      {create.isOpen && <CreateReturnModal invoiceId={create.data} onClose={create.close} />}
      {detail.data && (
        <Modal isOpen onClose={detail.close} title={`${t('sales.return')} ${detail.data.returnNumber}`} size="xl">
          <DetailGrid
            items={[
              { label: t('common.customer'), value: name(detail.data.customer ?? customerMap[detail.data.customerId]) },
              { label: t('common.date'), value: fmtDate(detail.data.date) },
              { label: t('sales.refundMethod'), value: t(`sales.refundMethods.${detail.data.refundMethod}`) },
              { label: t('common.status'), value: <Status status={detail.data.status} /> },
              { label: t('common.subtotal'), value: fmtMoney(detail.data.subtotal) },
              { label: t('common.tax'), value: fmtMoney(detail.data.taxAmount) },
              { label: t('common.total'), value: fmtMoney(detail.data.totalAmount) },
              { label: t('common.reason'), value: detail.data.reason || '-' },
            ]}
          />
          <div className="mt-4">
            <SimpleTable
              rows={detail.data.lines ?? []}
              columns={[
                { key: 'product', header: t('common.product'), render: (l) => name(l.product ?? productMap[l.productId]) },
                { key: 'quantity', header: t('common.quantity'), render: (l) => fmtQty(l.quantity) },
                { key: 'unitPrice', header: t('common.unitPrice'), render: (l) => fmtMoney(l.unitPrice) },
                { key: 'restock', header: t('sales.restock'), render: (l) => (l.restock ? t('common.yes') : t('common.no')) },
                { key: 'lineTotal', header: t('common.lineTotal'), render: (l) => fmtMoney(l.lineTotal) },
              ]}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}

function CreateReturnModal({ invoiceId, onClose }: { invoiceId: string | null; onClose: () => void }) {
  const t = useTranslations('ops');
  const name = useNamer();
  const [mode, setMode] = useState<'invoice' | 'cash'>('invoice');
  const [selectedInvoice, setSelectedInvoice] = useState(invoiceId ?? '');
  const { data: invoices = [] } = useOpsQuery(['sales-invoices'], opsSales.invoices);
  const { data: customers = [] } = useOpsCustomers();
  const { data: warehouses = [] } = useOpsWarehouses();
  const { data: products = [] } = useOpsProducts();
  const productMap = byId(products);
  const [lines, setLines] = useState<DocLine[]>([newLine()]);
  const [qty, setQty] = useState<Record<string, string>>({});
  const invoice = invoices.find((i) => i.id === selectedInvoice);
  const returnable = invoices.filter((i) => i.moveType !== 'credit_note' && !['draft', 'cancelled'].includes(i.status));

  const save = useOpsMutation((body: any) => opsSales.createReturn(body), {
    invalidate: ['sales-returns', 'sales-invoices', 'customers', 'stock-balance'],
    onSuccess: onClose,
  });

  const header: FieldDef[] = [
    ...(mode === 'cash' ? [{ name: 'customerId', label: t('common.customer'), type: 'select' as const, options: toOptions(customers, name) }] : []),
    { name: 'warehouseId', label: t('common.warehouse'), type: 'select', options: toOptions(warehouses, name), hint: t('sales.returnWarehouseHint') },
    { name: 'date', label: t('common.date'), type: 'date' },
    {
      name: 'refundMethod',
      label: t('sales.refundMethod'),
      type: 'select',
      required: true,
      options: ['credit', 'cash'].map((m) => ({ value: m, label: t(`sales.refundMethods.${m}`) })),
    },
    { name: 'reason', label: t('common.reason') },
    { name: 'post', label: t('common.postNow'), type: 'checkbox' },
  ];

  return (
    <Modal isOpen onClose={onClose} title={t('sales.newReturn')} size="xl">
      <Tabs
        value={mode}
        onChange={setMode}
        tabs={[
          { key: 'invoice', label: t('sales.returnFromInvoice') },
          { key: 'cash', label: t('sales.cashReturn') },
        ]}
      />
      <EntityForm
        key={mode}
        fields={header}
        columns={3}
        initial={{ date: today(), refundMethod: mode === 'cash' ? 'cash' : 'credit', warehouseId: warehouses[0]?.id, post: true }}
        loading={save.isPending}
        onCancel={onClose}
        onSubmit={(h) => {
          if (mode === 'invoice') {
            if (!invoice) return;
            const l = (invoice.lines ?? [])
              .map((x: any) => ({ invoiceLineId: x.id, quantity: num(qty[x.id]) }))
              .filter((x: any) => x.quantity > 0);
            if (!l.length) return;
            save.mutate({ ...h, originalInvoiceId: invoice.id, lines: l });
          } else {
            const l = linesPayload(lines, { requirePrice: true });
            if (!l.length) return;
            save.mutate({ ...h, lines: l });
          }
        }}
      >
        {mode === 'invoice' ? (
          <div className="space-y-3">
            <select value={selectedInvoice} onChange={(e) => { setSelectedInvoice(e.target.value); setQty({}); }} className={inputCls} required>
              <option value="">{t('sales.selectInvoice')}</option>
              {returnable.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.invoiceNumber} - {name(i.customer)} - {fmtMoney(i.totalAmount)}
                </option>
              ))}
            </select>
            {invoice && (
              <SimpleTable
                rows={invoice.lines ?? []}
                columns={[
                  { key: 'product', header: t('common.product'), render: (l) => name(l.product ?? productMap[l.productId]) },
                  { key: 'quantity', header: t('sales.sold'), render: (l) => fmtQty(l.quantity) },
                  { key: 'qtyReturned', header: t('sales.returned'), render: (l) => fmtQty(l.qtyReturned) },
                  { key: 'unitPrice', header: t('common.unitPrice'), render: (l) => fmtMoney(l.unitPrice) },
                  {
                    key: 'ret',
                    header: t('sales.returnQty'),
                    render: (l) => (
                      <input
                        type="number"
                        step="any"
                        min="0"
                        max={num(l.quantity) - num(l.qtyReturned)}
                        value={qty[l.id] ?? ''}
                        onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })}
                        className={`${inputSm} w-28`}
                      />
                    ),
                  },
                ]}
              />
            )}
          </div>
        ) : (
          <LinesEditor lines={lines} onChange={setLines} products={products} priceField="sellPrice" taxField="salesTaxRate" />
        )}
      </EntityForm>
    </Modal>
  );
}
