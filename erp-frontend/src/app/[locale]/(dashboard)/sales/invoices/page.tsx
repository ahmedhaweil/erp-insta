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
import CreateSalesDocModal from '@/components/operations/sales/CreateSalesDocModal';
import InstallmentPlanModal from '@/components/operations/sales/InstallmentPlanModal';
import { useOpsCustomers, useOpsMutation, useOpsProducts, useOpsQuery } from '@/hooks/use-operations';
import { opsSales } from '@/services/operations-sales.service';
import type { Row } from '@/services/operations-api';
import { PrintButton } from '@/components/platform/PrintButton';

const OPEN = ['posted', 'sent', 'partial', 'overdue'];
const STATUSES = ['draft', 'posted', 'partial', 'paid', 'overdue', 'cancelled'];

export default function SalesInvoicesPage() {
  const t = useTranslations('ops');
  const name = useNamer();
  const router = useRouter();
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const { data: invoices = [], isLoading } = useOpsQuery(['sales-invoices'], opsSales.invoices);
  const { data: customers = [] } = useOpsCustomers();
  const { data: products = [] } = useOpsProducts();
  const customerMap = byId(customers);
  const productMap = byId(products);
  const create = useModal();
  const detail = useModal<Row>();
  const pay = useModal<Row>();
  const credit = useModal<Row>();
  const plan = useModal<Row>();

  const inv = ['sales-invoices', 'customers', 'sales-orders'];
  const post = useOpsMutation((id: string) => opsSales.postInvoice(id), { invalidate: inv, success: 'posted' });
  const cancel = useOpsMutation((id: string) => opsSales.cancelInvoice(id), { invalidate: inv, success: 'cancelled' });
  const markPaid = useOpsMutation((id: string) => opsSales.payInvoice(id), { invalidate: inv, success: 'paid' });
  const registerPayment = useOpsMutation((body: any) => opsSales.registerPayment(body), {
    invalidate: inv,
    success: 'paymentRegistered',
    onSuccess: () => pay.close(),
  });
  const creditNote = useOpsMutation((a: { id: string; body: any }) => opsSales.creditNote(a.id, a.body), {
    invalidate: inv,
    success: 'creditNoteCreated',
    onSuccess: () => credit.close(),
  });

  const rows = invoices.filter((i) => (!status || i.status === status) && (!type || i.moveType === type));
  const residual = (i: Row) => num(i.totalAmount) - num(i.paidAmount);

  return (
    <div>
      <PageHeader title={t('sales.invoices')} action={{ label: t('sales.newInvoice'), onClick: () => create.open() }} />
      <FilterBar>
        <Field label={t('common.status')}>
          <SelectBox value={status} onChange={setStatus} emptyLabel={t('common.all')} options={STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) }))} />
        </Field>
        <Field label={t('common.type')}>
          <SelectBox
            value={type}
            onChange={setType}
            emptyLabel={t('common.all')}
            options={[
              { value: 'invoice', label: t('sales.invoice') },
              { value: 'credit_note', label: t('sales.creditNote') },
            ]}
          />
        </Field>
      </FilterBar>
      <DataTable
        data={rows}
        loading={isLoading}
        searchable
        pageSize={20}
        onRowClick={(i: Row) => detail.open(i)}
        columns={[
          { key: 'invoiceNumber', header: t('common.number') },
          { key: 'moveType', header: t('common.type'), render: (i: Row) => (i.moveType === 'credit_note' ? t('sales.creditNote') : t('sales.invoice')) },
          { key: 'customerId', header: t('common.customer'), render: (i: Row) => name(i.customer ?? customerMap[i.customerId]) },
          { key: 'date', header: t('common.date'), render: (i: Row) => fmtDate(i.date) },
          { key: 'dueDate', header: t('common.dueDate'), render: (i: Row) => fmtDate(i.dueDate) },
          { key: 'totalAmount', header: t('common.total'), render: (i: Row) => fmtMoney(i.totalAmount) },
          { key: 'paidAmount', header: t('common.paid'), render: (i: Row) => fmtMoney(i.paidAmount) },
          { key: 'status', header: t('common.status'), render: (i: Row) => <Status status={i.status} /> },
        ]}
        actions={(i: Row) => {
          const isInvoice = i.moveType !== 'credit_note';
          return (
            <RowActions>
              <PrintButton path={`/print/sales-invoices/${i.id}`} />
              {i.status === 'draft' && <RowAction onClick={() => post.mutate(i.id)}>{t('sales.post')}</RowAction>}
              {isInvoice && OPEN.includes(i.status) && (
                <>
                  <RowAction tone="green" onClick={() => pay.open(i)}>{t('sales.registerPayment')}</RowAction>
                  <RowAction tone="green" onClick={() => markPaid.mutate(i.id)}>{t('sales.markPaid')}</RowAction>
                  <RowAction tone="amber" onClick={() => credit.open(i)}>{t('sales.creditNote')}</RowAction>
                  <RowAction tone="gray" onClick={() => router.push(`/sales/returns?invoiceId=${i.id}`)}>{t('sales.return')}</RowAction>
                  <RowAction tone="gray" onClick={() => plan.open(i)}>{t('sales.installmentPlan')}</RowAction>
                </>
              )}
              {i.status !== 'cancelled' && num(i.paidAmount) === 0 && (
                <RowAction tone="red" onClick={() => cancel.mutate(i.id)}>{t('common.cancel')}</RowAction>
              )}
            </RowActions>
          );
        }}
      />

      {create.isOpen && <CreateSalesDocModal kind="invoice" onClose={create.close} />}

      {detail.data && (
        <Modal isOpen onClose={detail.close} title={`${detail.data.moveType === 'credit_note' ? t('sales.creditNote') : t('sales.invoice')} ${detail.data.invoiceNumber}`} size="xl">
          <DetailGrid
            items={[
              { label: t('common.customer'), value: name(detail.data.customer ?? customerMap[detail.data.customerId]) },
              { label: t('common.date'), value: fmtDate(detail.data.date) },
              { label: t('common.dueDate'), value: fmtDate(detail.data.dueDate) },
              { label: t('common.status'), value: <Status status={detail.data.status} /> },
              { label: t('common.subtotal'), value: fmtMoney(detail.data.subtotal) },
              { label: t('common.tax'), value: fmtMoney(detail.data.taxAmount) },
              { label: t('sales.withholding'), value: fmtMoney(detail.data.withholdingAmount) },
              { label: t('common.total'), value: fmtMoney(detail.data.totalAmount) },
              { label: t('common.paid'), value: fmtMoney(detail.data.paidAmount) },
              { label: t('common.residual'), value: fmtMoney(residual(detail.data)) },
              { label: t('common.notes'), value: detail.data.notes || '-' },
            ]}
          />
          <div className="mt-4">
            <SimpleTable
              rows={detail.data.lines ?? []}
              columns={[
                { key: 'product', header: t('common.product'), render: (l) => name(l.product ?? productMap[l.productId]) },
                { key: 'quantity', header: t('common.quantity'), render: (l) => fmtQty(l.quantity) },
                { key: 'unitPrice', header: t('common.unitPrice'), render: (l) => fmtMoney(l.unitPrice) },
                { key: 'discount', header: t('common.discountAmount'), render: (l) => fmtMoney(l.discount) },
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
              {
                name: 'method',
                label: t('sales.paymentMethod'),
                type: 'select',
                required: true,
                options: ['cash', 'bank', 'card'].map((m) => ({ value: m, label: t(`sales.methods.${m}`) })),
              },
              { name: 'reference', label: t('common.reference') },
            ]}
            initial={{ amount: residual(pay.data).toFixed(2), date: today(), method: 'cash' }}
            loading={registerPayment.isPending}
            onCancel={pay.close}
            onSubmit={(p) =>
              registerPayment.mutate({ partnerId: pay.data!.customerId, invoiceId: pay.data!.id, amount: p.amount, date: p.date, method: p.method, reference: p.reference })
            }
          />
        </Modal>
      )}

      {credit.data && (
        <LineQtyModal
          title={`${t('sales.creditNote')} - ${credit.data.invoiceNumber}`}
          infoHeader={t('common.quantity')}
          lines={(credit.data.lines ?? []).map((l: any) => {
            const rest = Math.max(0, num(l.quantity) - num(l.qtyReturned));
            return { id: l.id, label: name(l.product ?? productMap[l.productId]), info: fmtQty(l.quantity), max: rest, initial: rest };
          })}
          fields={[
            { name: 'reason', label: t('common.reason'), wide: true },
            { name: 'date', label: t('common.date'), type: 'date' },
            { name: 'post', label: t('common.postNow'), type: 'checkbox' },
          ]}
          initial={{ date: today(), post: true }}
          submitLabel={t('sales.createCreditNote')}
          loading={creditNote.isPending}
          onClose={credit.close}
          onSubmit={(h, lines) =>
            creditNote.mutate({ id: credit.data!.id, body: { ...h, lines: lines.map((l) => ({ invoiceLineId: l.id, quantity: l.quantity })) } })
          }
        />
      )}

      {plan.data && <InstallmentPlanModal invoice={plan.data} onClose={plan.close} />}
    </div>
  );
}
