'use client';

import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import { useSalesOrders, useConfirmSalesOrder, useCancelSalesOrder } from '@/hooks/use-sales';
import { useDocumentAction } from '@/hooks/use-document-action';
import { salesService } from '@/services/sales.service';
import type { SalesOrder } from '@/types';

const ACTION_CLASS = 'text-sm hover:underline disabled:opacity-50';

export default function SalesOrdersPage() {
  const t = useTranslations('sales');
  const tc = useTranslations('common');

  const { data: orders = [], isLoading } = useSalesOrders();
  const confirmMutation = useConfirmSalesOrder();
  const cancelMutation = useCancelSalesOrder();
  const sendMutation = useDocumentAction((id: string) => salesService.sendQuotation(id), {
    invalidate: ['sales-orders'],
    success: t('quotationSent'),
    error: tc('error'),
  });
  const deliverMutation = useDocumentAction((id: string) => salesService.deliverSalesOrder(id), {
    invalidate: ['sales-orders', 'stock'],
    success: t('deliveryValidated'),
    error: tc('error'),
  });
  const invoiceMutation = useDocumentAction((id: string) => salesService.invoiceSalesOrder(id), {
    invalidate: ['sales-orders', 'sales-invoices'],
    success: t('invoiceCreated'),
    error: tc('error'),
  });

  const columns = [
    { key: 'orderNumber', header: t('orderNumber') },
    { key: 'date', header: tc('date') },
    { key: 'status', header: tc('status'), render: (item: SalesOrder) => <StatusBadge status={item.status} label={tc(item.status)} /> },
    { key: 'totalAmount', header: tc('total'), render: (item: SalesOrder) => Number(item.totalAmount).toFixed(2) },
    {
      key: 'invoiceStatus', header: t('invoiceStatus'),
      render: (item: SalesOrder) => (item.invoiceStatus && item.invoiceStatus !== 'nothing' ? t(`invoiceStatuses.${item.invoiceStatus}`) : '-'),
    },
    {
      key: 'actions', header: tc('actions'),
      render: (item: SalesOrder) => {
        const canInvoice =
          ['confirmed', 'delivered'].includes(item.status) && item.invoiceStatus !== 'invoiced';
        return (
          <div className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
            {item.status === 'draft' && (
              <button onClick={() => sendMutation.mutate(item.id)} disabled={sendMutation.isPending} className={`${ACTION_CLASS} text-gray-600`}>
                {t('sendQuotation')}
              </button>
            )}
            {['draft', 'sent'].includes(item.status) && (
              <button onClick={() => confirmMutation.mutate(item.id)} disabled={confirmMutation.isPending} className={`${ACTION_CLASS} text-primary-600`}>
                {t('confirmOrder')}
              </button>
            )}
            {item.status === 'confirmed' && (
              <button onClick={() => deliverMutation.mutate(item.id)} disabled={deliverMutation.isPending} className={`${ACTION_CLASS} text-blue-600`}>
                {t('deliver')}
              </button>
            )}
            {canInvoice && (
              <button onClick={() => invoiceMutation.mutate(item.id)} disabled={invoiceMutation.isPending} className={`${ACTION_CLASS} text-green-600`}>
                {t('createInvoice')}
              </button>
            )}
            {['draft', 'sent', 'confirmed'].includes(item.status) && (
              <button onClick={() => cancelMutation.mutate(item.id)} disabled={cancelMutation.isPending} className={`${ACTION_CLASS} text-red-600`}>
                {t('cancelOrder')}
              </button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader title={t('orders')} action={{ label: t('newOrder'), onClick: () => {} }} />
      <DataTable columns={columns} data={orders} loading={isLoading} searchable />
    </div>
  );
}
