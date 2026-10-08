'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { EntityForm, Field, SelectBox, toOptions } from '@/components/operations/form';
import {
  byId, DetailGrid, FilterBar, fmtDate, fmtMoney, fmtQty, num, RowAction, RowActions, SimpleTable, Status, today, useModal, useNamer,
} from '@/components/operations/common';
import CreateSalesDocModal from '@/components/operations/sales/CreateSalesDocModal';
import LineQtyModal from '@/components/operations/LineQtyModal';
import {
  useOpsCustomers, useOpsMutation, useOpsProducts, useOpsQuery, useOpsWarehouses,
} from '@/hooks/use-operations';
import { opsSales } from '@/services/operations-sales.service';
import type { Row } from '@/services/operations-api';

const STATUSES = ['draft', 'sent', 'confirmed', 'delivered', 'cancelled'];

/** Quotations and sales orders: send, confirm, deliver from a warehouse, invoice. */
export default function SalesOrdersPage() {
  const t = useTranslations('ops');
  const name = useNamer();
  const [status, setStatus] = useState('');
  const { data: orders = [], isLoading } = useOpsQuery(['sales-orders'], opsSales.orders);
  const { data: customers = [] } = useOpsCustomers();
  const { data: products = [] } = useOpsProducts();
  const { data: warehouses = [] } = useOpsWarehouses();
  const customerMap = byId(customers);
  const productMap = byId(products);
  const create = useModal();
  const detail = useModal<Row>();
  const deliver = useModal<Row>();
  const invoice = useModal<Row>();

  const inv = ['sales-orders', 'sales-invoices', 'customers', 'stock-balance'];
  const send = useOpsMutation((id: string) => opsSales.sendOrder(id), { invalidate: inv, success: 'sent' });
  const confirm = useOpsMutation((id: string) => opsSales.confirmOrder(id), { invalidate: inv, success: 'confirmed' });
  const cancel = useOpsMutation((id: string) => opsSales.cancelOrder(id), { invalidate: inv, success: 'cancelled' });
  const doDeliver = useOpsMutation(
    (a: { id: string; body: any }) => opsSales.deliverOrder(a.id, a.body),
    { invalidate: inv, success: 'delivered', onSuccess: () => deliver.close() },
  );
  const doInvoice = useOpsMutation(
    (a: { id: string; body: any }) => opsSales.invoiceOrder(a.id, a.body),
    { invalidate: inv, success: 'invoiced', onSuccess: () => invoice.close() },
  );

  const rows = status ? orders.filter((o) => o.status === status) : orders;
  const pname = (l: any) => name(l.product ?? productMap[l.productId]);

  return (
    <div>
      <PageHeader title={t('sales.orders')} action={{ label: t('sales.newQuotation'), onClick: () => create.open() }} />
      <FilterBar>
        <Field label={t('common.status')}>
          <SelectBox value={status} onChange={setStatus} emptyLabel={t('common.all')} options={STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) }))} />
        </Field>
      </FilterBar>
      <DataTable
        data={rows}
        loading={isLoading}
        searchable
        pageSize={20}
        onRowClick={(o: Row) => detail.open(o)}
        columns={[
          { key: 'orderNumber', header: t('common.number') },
          { key: 'date', header: t('common.date'), render: (o: Row) => fmtDate(o.date) },
          { key: 'customerId', header: t('common.customer'), render: (o: Row) => name(o.customer ?? customerMap[o.customerId]) },
          { key: 'totalAmount', header: t('common.total'), render: (o: Row) => fmtMoney(o.totalAmount) },
          { key: 'status', header: t('common.status'), render: (o: Row) => <Status status={o.status} /> },
          { key: 'deliveryStatus', header: t('sales.delivery'), render: (o: Row) => <Status status={o.deliveryStatus} /> },
          { key: 'invoiceStatus', header: t('sales.invoicing'), render: (o: Row) => <Status status={o.invoiceStatus} /> },
        ]}
        actions={(o: Row) => (
          <RowActions>
            {o.status === 'draft' && <RowAction onClick={() => send.mutate(o.id)}>{t('sales.markSent')}</RowAction>}
            {['draft', 'sent'].includes(o.status) && <RowAction tone="green" onClick={() => confirm.mutate(o.id)}>{t('sales.confirmOrder')}</RowAction>}
            {['confirmed'].includes(o.status) && o.deliveryStatus !== 'delivered' && (
              <RowAction tone="green" onClick={() => deliver.open(o)}>{t('sales.deliver')}</RowAction>
            )}
            {['confirmed', 'delivered'].includes(o.status) && ['to_invoice', 'partial'].includes(o.invoiceStatus) && (
              <RowAction tone="amber" onClick={() => invoice.open(o)}>{t('sales.createInvoice')}</RowAction>
            )}
            {!['cancelled', 'delivered'].includes(o.status) && o.invoiceStatus !== 'invoiced' && (
              <RowAction tone="red" onClick={() => cancel.mutate(o.id)}>{t('common.cancel')}</RowAction>
            )}
          </RowActions>
        )}
      />

      {create.isOpen && <CreateSalesDocModal kind="order" onClose={create.close} />}

      {detail.data && (
        <Modal isOpen onClose={detail.close} title={`${t('sales.order')} ${detail.data.orderNumber}`} size="xl">
          <DetailGrid
            items={[
              { label: t('common.customer'), value: name(detail.data.customer ?? customerMap[detail.data.customerId]) },
              { label: t('common.date'), value: fmtDate(detail.data.date) },
              { label: t('sales.validityDate'), value: fmtDate(detail.data.validityDate) },
              { label: t('common.warehouse'), value: name(warehouses.find((w) => w.id === detail.data!.warehouseId)) },
              { label: t('common.status'), value: <Status status={detail.data.status} /> },
              { label: t('common.subtotal'), value: fmtMoney(detail.data.subtotal) },
              { label: t('common.tax'), value: fmtMoney(detail.data.taxAmount) },
              { label: t('common.total'), value: fmtMoney(detail.data.totalAmount) },
            ]}
          />
          <div className="mt-4">
            <SimpleTable
              rows={detail.data.lines ?? []}
              columns={[
                { key: 'product', header: t('common.product'), render: pname },
                { key: 'quantity', header: t('common.quantity'), render: (l) => fmtQty(l.quantity) },
                { key: 'unitPrice', header: t('common.unitPrice'), render: (l) => fmtMoney(l.unitPrice) },
                { key: 'discount', header: t('common.discountAmount'), render: (l) => fmtMoney(l.discount) },
                { key: 'taxRate', header: t('common.taxRate'), render: (l) => `${num(l.taxRate)}%` },
                { key: 'qtyDelivered', header: t('sales.delivered'), render: (l) => fmtQty(l.qtyDelivered) },
                { key: 'qtyInvoiced', header: t('sales.invoiced'), render: (l) => fmtQty(l.qtyInvoiced) },
                { key: 'lineTotal', header: t('common.lineTotal'), render: (l) => fmtMoney(l.lineTotal) },
              ]}
            />
          </div>
        </Modal>
      )}

      {deliver.data && (
        <LineQtyModal
          title={`${t('sales.deliver')} ${deliver.data.orderNumber}`}
          infoHeader={t('sales.delivered')}
          lines={(deliver.data.lines ?? []).map((l: any) => {
            const rest = Math.max(0, num(l.quantity) - num(l.qtyDelivered));
            return { id: l.id, label: pname(l), info: fmtQty(l.qtyDelivered), max: rest, initial: rest };
          })}
          fields={[
            { name: 'warehouseId', label: t('common.warehouse'), type: 'select', required: true, options: toOptions(warehouses, name) },
            { name: 'date', label: t('common.date'), type: 'date' },
          ]}
          initial={{ warehouseId: deliver.data.warehouseId ?? warehouses[0]?.id, date: today() }}
          submitLabel={t('sales.deliver')}
          loading={doDeliver.isPending}
          onClose={deliver.close}
          onSubmit={(h, lines) =>
            doDeliver.mutate({ id: deliver.data!.id, body: { ...h, lines: lines.map((l) => ({ lineId: l.id, quantity: l.quantity })) } })
          }
        />
      )}

      {invoice.data && (
        <Modal isOpen onClose={invoice.close} title={`${t('sales.createInvoice')} - ${invoice.data.orderNumber}`}>
          <EntityForm
            fields={[
              {
                name: 'policy',
                label: t('sales.invoicePolicy'),
                type: 'select',
                required: true,
                options: [
                  { value: 'delivered', label: t('sales.policyDelivered') },
                  { value: 'ordered', label: t('sales.policyOrdered') },
                ],
              },
              { name: 'date', label: t('common.date'), type: 'date' },
              { name: 'post', label: t('common.postNow'), type: 'checkbox' },
            ]}
            initial={{ policy: invoice.data.deliveryStatus === 'pending' ? 'ordered' : 'delivered', date: today(), post: true }}
            loading={doInvoice.isPending}
            onCancel={invoice.close}
            onSubmit={(p) => doInvoice.mutate({ id: invoice.data!.id, body: p })}
          />
        </Modal>
      )}
    </div>
  );
}
