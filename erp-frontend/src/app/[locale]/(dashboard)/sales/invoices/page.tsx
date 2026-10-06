'use client';

import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import { useSalesInvoices, useMarkInvoicePaid } from '@/hooks/use-sales';
import { useDocumentAction } from '@/hooks/use-document-action';
import { salesService } from '@/services/sales.service';
import { paymentsService } from '@/services/payments.service';
import type { SalesInvoice } from '@/types';

const ACTION_CLASS = 'text-sm hover:underline disabled:opacity-50';
const OPEN = ['posted', 'sent', 'partial', 'overdue'];

export default function SalesInvoicesPage() {
  const t = useTranslations('sales');
  const tc = useTranslations('common');

  const { data: invoices = [], isLoading } = useSalesInvoices();
  const payMutation = useMarkInvoicePaid();
  const invalidate = ['sales-invoices', 'customers'];
  const postMutation = useDocumentAction((id: string) => salesService.postInvoice(id), {
    invalidate, success: t('invoicePosted'), error: tc('error'),
  });
  const cancelMutation = useDocumentAction((id: string) => salesService.cancelInvoice(id), {
    invalidate, success: t('invoiceCancelled'), error: tc('error'),
  });
  const creditNoteMutation = useDocumentAction(
    (id: string) => salesService.createCreditNote(id, { post: true }),
    { invalidate, success: t('creditNoteCreated'), error: tc('error') },
  );
  const partialPayMutation = useDocumentAction(
    (input: { invoice: SalesInvoice; amount: number }) =>
      paymentsService.createPayment({
        partnerType: 'customer',
        partnerId: input.invoice.customerId,
        amount: input.amount,
        date: new Date().toISOString().split('T')[0],
        allocations: [{ invoiceId: input.invoice.id, amount: input.amount }],
      }),
    { invalidate, success: t('paymentRegistered'), error: tc('error') },
  );

  const registerPayment = (invoice: SalesInvoice) => {
    const residual = Number(invoice.totalAmount) - Number(invoice.paidAmount);
    const answer = window.prompt(t('paymentAmountPrompt'), residual.toFixed(2));
    const amount = Number(answer);
    if (answer && amount > 0) partialPayMutation.mutate({ invoice, amount: Math.min(amount, residual) });
  };

  const columns = [
    { key: 'invoiceNumber', header: t('invoiceNumber') },
    {
      key: 'moveType', header: t('type'),
      render: (item: SalesInvoice) => (item.moveType === 'credit_note' ? t('creditNote') : t('invoice')),
    },
    { key: 'date', header: tc('date') },
    { key: 'dueDate', header: t('dueDate') },
    { key: 'status', header: tc('status'), render: (item: SalesInvoice) => <StatusBadge status={item.status} label={tc(item.status)} /> },
    { key: 'totalAmount', header: tc('total'), render: (item: SalesInvoice) => Number(item.totalAmount).toFixed(2) },
    { key: 'paidAmount', header: tc('paid'), render: (item: SalesInvoice) => Number(item.paidAmount).toFixed(2) },
    {
      key: 'actions', header: tc('actions'),
      render: (item: SalesInvoice) => {
        const isInvoice = item.moveType !== 'credit_note';
        const unpaid = Number(item.paidAmount) === 0;
        return (
          <div className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
            {item.status === 'draft' && (
              <button onClick={() => postMutation.mutate(item.id)} disabled={postMutation.isPending} className={`${ACTION_CLASS} text-primary-600`}>
                {t('postInvoice')}
              </button>
            )}
            {isInvoice && OPEN.includes(item.status) && (
              <>
                <button onClick={() => registerPayment(item)} disabled={partialPayMutation.isPending} className={`${ACTION_CLASS} text-green-600`}>
                  {t('registerPayment')}
                </button>
                <button onClick={() => payMutation.mutate(item.id)} disabled={payMutation.isPending} className={`${ACTION_CLASS} text-green-700`}>
                  {t('markPaid')}
                </button>
              </>
            )}
            {isInvoice && !['draft', 'cancelled'].includes(item.status) && (
              <button onClick={() => creditNoteMutation.mutate(item.id)} disabled={creditNoteMutation.isPending} className={`${ACTION_CLASS} text-amber-600`}>
                {t('creditNote')}
              </button>
            )}
            {item.status !== 'cancelled' && unpaid && (
              <button onClick={() => cancelMutation.mutate(item.id)} disabled={cancelMutation.isPending} className={`${ACTION_CLASS} text-red-600`}>
                {tc('cancel')}
              </button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader title={t('invoices')} action={{ label: t('newInvoice'), onClick: () => {} }} />
      <DataTable columns={columns} data={invoices} loading={isLoading} searchable />
    </div>
  );
}
