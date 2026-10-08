'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { EntityForm, Field, SelectBox } from '@/components/operations/form';
import {
  byId, DetailGrid, FilterBar, fmtDate, fmtMoney, fmtQty, num, RowAction, RowActions, SimpleTable, Status, today, useModal, useNamer,
} from '@/components/operations/common';
import LineQtyModal from '@/components/operations/LineQtyModal';
import CreatePurchaseDocModal from '@/components/operations/purchasing/CreatePurchaseDocModal';
import { useOpsMutation, useOpsProducts, useOpsQuery, useOpsSuppliers } from '@/hooks/use-operations';
import { opsPurchasing } from '@/services/operations-purchasing.service';
import type { Row } from '@/services/operations-api';

const OPEN = ['approved', 'partial', 'overdue'];
const STATUSES = ['draft', 'approved', 'partial', 'paid', 'overdue', 'cancelled'];

/** Vendor bills and refunds. */
export default function VendorBillsPage() {
  const t = useTranslations('ops');
  const name = useNamer();
  const router = useRouter();
  const [status, setStatus] = useState('');
  const { data: bills = [], isLoading } = useOpsQuery(['bills'], opsPurchasing.bills);
  const { data: suppliers = [] } = useOpsSuppliers();
  const { data: products = [] } = useOpsProducts();
  const supMap = byId(suppliers);
  const productMap = byId(products);
  const create = useModal();
  const detail = useModal<Row>();
  const pay = useModal<Row>();
  const refund = useModal<Row>();

  const inv = ['bills', 'suppliers', 'purchase-orders'];
  const approve = useOpsMutation((id: string) => opsPurchasing.approveBill(id), { invalidate: inv, success: 'approved' });
  const markPaid = useOpsMutation((id: string) => opsPurchasing.payBill(id), { invalidate: inv, success: 'paid' });
  const cancel = useOpsMutation((id: string) => opsPurchasing.cancelBill(id), { invalidate: inv, success: 'cancelled' });
  const registerPayment = useOpsMutation((body: any) => opsPurchasing.registerPayment(body), {
    invalidate: inv,
    success: 'paymentRegistered',
    onSuccess: () => pay.close(),
  });
  const doRefund = useOpsMutation((a: { id: string; body: any }) => opsPurchasing.refundBill(a.id, a.body), {
    invalidate: inv,
    success: 'refundCreated',
    onSuccess: () => refund.close(),
  });

  const rows = status ? bills.filter((b) => b.status === status) : bills;
  const residual = (b: Row) => num(b.totalAmount) - num(b.paidAmount);

  return (
    <div>
      <PageHeader title={t('pur.bills')} action={{ label: t('pur.newBill'), onClick: () => create.open() }} />
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
        onRowClick={(b: Row) => detail.open(b)}
        columns={[
          { key: 'invoiceNumber', header: t('common.number') },
          { key: 'moveType', header: t('common.type'), render: (b: Row) => (b.moveType === 'refund' ? t('pur.refund') : t('pur.bill')) },
          { key: 'supplierId', header: t('common.supplier'), render: (b: Row) => name(b.supplier ?? supMap[b.supplierId]) },
          { key: 'supplierReference', header: t('pur.supplierReference') },
          { key: 'date', header: t('common.date'), render: (b: Row) => fmtDate(b.date) },
          { key: 'dueDate', header: t('common.dueDate'), render: (b: Row) => fmtDate(b.dueDate) },
          { key: 'totalAmount', header: t('common.total'), render: (b: Row) => fmtMoney(b.totalAmount) },
          { key: 'paidAmount', header: t('common.paid'), render: (b: Row) => fmtMoney(b.paidAmount) },
          { key: 'status', header: t('common.status'), render: (b: Row) => <Status status={b.status} /> },
        ]}
        actions={(b: Row) => {
          const isBill = b.moveType !== 'refund';
          return (
            <RowActions>
              {b.status === 'draft' && <RowAction tone="green" onClick={() => approve.mutate(b.id)}>{t('pur.approve')}</RowAction>}
              {isBill && OPEN.includes(b.status) && (
                <>
                  <RowAction tone="green" onClick={() => pay.open(b)}>{t('sales.registerPayment')}</RowAction>
                  <RowAction tone="green" onClick={() => markPaid.mutate(b.id)}>{t('sales.markPaid')}</RowAction>
                  <RowAction tone="amber" onClick={() => refund.open(b)}>{t('pur.refund')}</RowAction>
                  <RowAction tone="gray" onClick={() => router.push(`/purchasing/returns?billId=${b.id}`)}>{t('sales.return')}</RowAction>
                </>
              )}
              {b.status !== 'cancelled' && num(b.paidAmount) === 0 && (
                <RowAction tone="red" onClick={() => cancel.mutate(b.id)}>{t('common.cancel')}</RowAction>
              )}
            </RowActions>
          );
        }}
      />

      {create.isOpen && <CreatePurchaseDocModal kind="bill" onClose={create.close} />}

      {detail.data && (
        <Modal isOpen onClose={detail.close} title={`${detail.data.moveType === 'refund' ? t('pur.refund') : t('pur.bill')} ${detail.data.invoiceNumber}`} size="xl">
          <DetailGrid
            items={[
              { label: t('common.supplier'), value: name(detail.data.supplier ?? supMap[detail.data.supplierId]) },
              { label: t('pur.supplierReference'), value: detail.data.supplierReference || '-' },
              { label: t('common.date'), value: fmtDate(detail.data.date) },
              { label: t('common.dueDate'), value: fmtDate(detail.data.dueDate) },
              { label: t('common.status'), value: <Status status={detail.data.status} /> },
              { label: t('common.tax'), value: fmtMoney(detail.data.taxAmount) },
              { label: t('sales.withholding'), value: fmtMoney(detail.data.withholdingAmount) },
              { label: t('common.total'), value: fmtMoney(detail.data.totalAmount) },
              { label: t('common.paid'), value: fmtMoney(detail.data.paidAmount) },
              { label: t('common.residual'), value: fmtMoney(residual(detail.data)) },
            ]}
          />
          <div className="mt-4">
            <SimpleTable
              rows={detail.data.lines ?? []}
              columns={[
                { key: 'product', header: t('common.product'), render: (l) => name(l.product ?? productMap[l.productId]) },
                { key: 'quantity', header: t('common.quantity'), render: (l) => fmtQty(l.quantity) },
                { key: 'unitPrice', header: t('common.unitPrice'), render: (l) => fmtMoney(l.unitPrice) },
                { key: 'taxRate', header: t('common.taxRate'), render: (l) => `${num(l.taxRate)}%` },
                { key: 'qtyReturned', header: t('sales.returned'), render: (l) => fmtQty(l.qtyReturned) },
                { key: 'lineTotal', header: t('common.lineTotal'), render: (l) => fmtMoney(l.lineTotal) },
              ]}
            />
          </div>
        </Modal>
      )}

      {pay.data && (
        <Modal isOpen onClose={pay.close} title={`${t('sales.registerPayment')} - ${pay.data.invoiceNumber}`}>
          <EntityForm
            fields={[
              { name: 'amount', label: t('common.amount'), type: 'number', required: true, min: 0.01, max: residual(pay.data) },
              { name: 'date', label: t('common.date'), type: 'date', required: true },
              { name: 'method', label: t('sales.paymentMethod'), type: 'select', required: true, options: ['cash', 'bank', 'card'].map((m) => ({ value: m, label: t(`sales.methods.${m}`) })) },
              { name: 'reference', label: t('common.reference') },
            ]}
            initial={{ amount: residual(pay.data).toFixed(2), date: today(), method: 'bank' }}
            loading={registerPayment.isPending}
            onCancel={pay.close}
            onSubmit={(p) => registerPayment.mutate({ partnerId: pay.data!.supplierId, invoiceId: pay.data!.id, ...p })}
          />
        </Modal>
      )}

      {refund.data && (
        <LineQtyModal
          title={`${t('pur.refund')} - ${refund.data.invoiceNumber}`}
          infoHeader={t('common.quantity')}
          lines={(refund.data.lines ?? []).map((l: any) => {
            const rest = Math.max(0, num(l.quantity) - num(l.qtyReturned));
            return { id: l.id, label: name(l.product ?? productMap[l.productId]), info: fmtQty(l.quantity), max: rest, initial: rest };
          })}
          fields={[
            { name: 'reason', label: t('common.reason'), wide: true },
            { name: 'date', label: t('common.date'), type: 'date' },
            { name: 'post', label: t('pur.approveNow'), type: 'checkbox' },
          ]}
          initial={{ date: today(), post: true }}
          submitLabel={t('pur.createRefund')}
          loading={doRefund.isPending}
          onClose={refund.close}
          onSubmit={(h, lines) => doRefund.mutate({ id: refund.data!.id, body: { ...h, lines: lines.map((l) => ({ invoiceLineId: l.id, quantity: l.quantity })) } })}
        />
      )}
    </div>
  );
}
