'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { EntityForm, Field, SelectBox, toOptions } from '@/components/operations/form';
import {
  byId, DetailGrid, FilterBar, fmtDate, fmtMoney, fmtQty, num, PromptModal, RowAction, RowActions, SimpleTable, Status, today, useModal, useNamer,
} from '@/components/operations/common';
import LineQtyModal from '@/components/operations/LineQtyModal';
import CreatePurchaseDocModal from '@/components/operations/purchasing/CreatePurchaseDocModal';
import { useOpsMutation, useOpsProducts, useOpsQuery, useOpsSuppliers, useOpsWarehouses } from '@/hooks/use-operations';
import { opsPurchasing } from '@/services/operations-purchasing.service';
import type { Row } from '@/services/operations-api';
import { PrintButton } from '@/components/platform/PrintButton';

const STATUSES = ['draft', 'sent', 'to_approve', 'confirmed', 'received', 'cancelled'];

/** RFQs and purchase orders: send, confirm (with approval), receive, bill. */
export default function PurchaseOrdersPage() {
  const t = useTranslations('ops');
  const name = useNamer();
  const [status, setStatus] = useState('');
  const { data: orders = [], isLoading } = useOpsQuery(['purchase-orders'], opsPurchasing.orders);
  const { data: suppliers = [] } = useOpsSuppliers();
  const { data: products = [] } = useOpsProducts();
  const { data: warehouses = [] } = useOpsWarehouses();
  const supMap = byId(suppliers);
  const productMap = byId(products);
  const create = useModal();
  const detail = useModal<Row>();
  const reject = useModal<Row>();
  const receive = useModal<Row>();
  const bill = useModal<Row>();

  const inv = ['purchase-orders', 'bills', 'stock-balance', 'replenishment'];
  const send = useOpsMutation((id: string) => opsPurchasing.sendOrder(id), { invalidate: inv, success: 'sent' });
  const confirm = useOpsMutation((id: string) => opsPurchasing.confirmOrder(id), {
    invalidate: inv,
    success: false,
    onSuccess: (po: any) => (po?.status === 'to_approve' ? toast.info(t('pur.sentForApproval')) : toast.success(t('msg.confirmed'))),
  });
  const approve = useOpsMutation((id: string) => opsPurchasing.approveOrder(id), { invalidate: inv, success: 'approved' });
  const doReject = useOpsMutation((a: { id: string; reason: string }) => opsPurchasing.rejectOrder(a.id, a.reason), {
    invalidate: inv,
    success: 'rejected',
    onSuccess: () => reject.close(),
  });
  const cancel = useOpsMutation((id: string) => opsPurchasing.cancelOrder(id), { invalidate: inv, success: 'cancelled' });
  const doReceive = useOpsMutation((a: { id: string; body: any }) => opsPurchasing.receiveOrder(a.id, a.body), {
    invalidate: inv,
    success: 'received',
    onSuccess: () => receive.close(),
  });
  const doBill = useOpsMutation((a: { id: string; body: any }) => opsPurchasing.billOrder(a.id, a.body), {
    invalidate: inv,
    success: 'billed',
    onSuccess: () => bill.close(),
  });

  const rows = status ? orders.filter((o) => o.status === status) : orders;
  const pname = (l: any) => name(l.product ?? productMap[l.productId]);

  return (
    <div>
      <PageHeader title={t('pur.orders')} action={{ label: t('pur.newRfq'), onClick: () => create.open() }} />
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
          { key: 'supplierId', header: t('common.supplier'), render: (o: Row) => name(o.supplier ?? supMap[o.supplierId]) },
          { key: 'expectedDate', header: t('pur.expectedDate'), render: (o: Row) => fmtDate(o.expectedDate) },
          { key: 'totalAmount', header: t('common.total'), render: (o: Row) => fmtMoney(o.totalAmount) },
          { key: 'status', header: t('common.status'), render: (o: Row) => <Status status={o.status} /> },
          { key: 'billStatus', header: t('pur.billing'), render: (o: Row) => <Status status={o.billStatus} /> },
        ]}
        actions={(o: Row) => {
          const received = (o.lines ?? []).every((l: any) => num(l.qtyReceived) >= num(l.quantity));
          return (
            <RowActions>
              <PrintButton path={`/print/purchase-orders/${o.id}`} />
              {o.status === 'draft' && <RowAction onClick={() => send.mutate(o.id)}>{t('pur.markSent')}</RowAction>}
              {['draft', 'sent'].includes(o.status) && <RowAction tone="green" onClick={() => confirm.mutate(o.id)}>{t('pur.confirmOrder')}</RowAction>}
              {o.status === 'to_approve' && (
                <>
                  <RowAction tone="green" onClick={() => approve.mutate(o.id)}>{t('pur.approve')}</RowAction>
                  <RowAction tone="red" onClick={() => reject.open(o)}>{t('pur.reject')}</RowAction>
                </>
              )}
              {o.status === 'confirmed' && !received && <RowAction tone="green" onClick={() => receive.open(o)}>{t('pur.receive')}</RowAction>}
              {['confirmed', 'received'].includes(o.status) && ['to_bill', 'partial'].includes(o.billStatus) && (
                <RowAction tone="amber" onClick={() => bill.open(o)}>{t('pur.createBill')}</RowAction>
              )}
              {['draft', 'sent', 'to_approve', 'confirmed'].includes(o.status) && o.billStatus !== 'billed' && (
                <RowAction tone="red" onClick={() => cancel.mutate(o.id)}>{t('common.cancel')}</RowAction>
              )}
            </RowActions>
          );
        }}
      />

      {create.isOpen && <CreatePurchaseDocModal kind="order" onClose={create.close} />}

      {detail.data && (
        <Modal isOpen onClose={detail.close} title={`${t('pur.order')} ${detail.data.orderNumber}`} size="xl">
          <DetailGrid
            items={[
              { label: t('common.supplier'), value: name(detail.data.supplier ?? supMap[detail.data.supplierId]) },
              { label: t('common.date'), value: fmtDate(detail.data.date) },
              { label: t('pur.expectedDate'), value: fmtDate(detail.data.expectedDate) },
              { label: t('common.status'), value: <Status status={detail.data.status} /> },
              { label: t('pur.approvedAt'), value: fmtDate(detail.data.approvedAt) },
              { label: t('pur.rejectionReason'), value: detail.data.rejectionReason || '-' },
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
                { key: 'taxRate', header: t('common.taxRate'), render: (l) => `${num(l.taxRate)}%` },
                { key: 'qtyReceived', header: t('pur.received'), render: (l) => fmtQty(l.qtyReceived) },
                { key: 'qtyBilled', header: t('pur.billed'), render: (l) => fmtQty(l.qtyBilled) },
                { key: 'lineTotal', header: t('common.lineTotal'), render: (l) => fmtMoney(l.lineTotal) },
              ]}
            />
          </div>
        </Modal>
      )}

      <PromptModal
        isOpen={reject.isOpen}
        title={t('pur.reject')}
        label={t('common.reason')}
        required={false}
        loading={doReject.isPending}
        onClose={reject.close}
        onSubmit={(reason) => reject.data && doReject.mutate({ id: reject.data.id, reason })}
      />

      {receive.data && (
        <LineQtyModal
          title={`${t('pur.receive')} ${receive.data.orderNumber}`}
          infoHeader={t('pur.received')}
          lines={(receive.data.lines ?? []).map((l: any) => {
            const rest = Math.max(0, num(l.quantity) - num(l.qtyReceived));
            return { id: l.id, label: pname(l), info: fmtQty(l.qtyReceived), max: rest, initial: rest };
          })}
          fields={[{ name: 'warehouseId', label: t('common.warehouse'), type: 'select', required: true, options: toOptions(warehouses, name) }]}
          initial={{ warehouseId: receive.data.warehouseId ?? warehouses[0]?.id }}
          submitLabel={t('pur.receive')}
          loading={doReceive.isPending}
          onClose={receive.close}
          onSubmit={(h, lines) => doReceive.mutate({ id: receive.data!.id, body: { ...h, lines: lines.map((l) => ({ lineId: l.id, quantity: l.quantity })) } })}
        />
      )}

      {bill.data && (
        <Modal isOpen onClose={bill.close} title={`${t('pur.createBill')} - ${bill.data.orderNumber}`}>
          <p className="text-sm text-gray-600 mb-3">{t('pur.billHint')}</p>
          <EntityForm
            fields={[
              { name: 'date', label: t('common.date'), type: 'date' },
              { name: 'supplierReference', label: t('pur.supplierReference') },
              { name: 'post', label: t('pur.approveNow'), type: 'checkbox' },
            ]}
            initial={{ date: today(), post: true }}
            loading={doBill.isPending}
            onCancel={bill.close}
            onSubmit={(p) => doBill.mutate({ id: bill.data!.id, body: p })}
          />
        </Modal>
      )}
    </div>
  );
}
