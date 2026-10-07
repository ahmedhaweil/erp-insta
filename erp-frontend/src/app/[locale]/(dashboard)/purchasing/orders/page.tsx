'use client';

import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import { usePurchaseOrders, useConfirmPurchaseOrder } from '@/hooks/use-purchasing';
import { useDocumentAction } from '@/hooks/use-document-action';
import { purchasingService } from '@/services/purchasing.service';
import type { PurchaseOrder } from '@/types';

const ACTION_CLASS = 'text-sm hover:underline disabled:opacity-50';

export default function PurchaseOrdersPage() {
  const t = useTranslations('purchasing');
  const tc = useTranslations('common');

  const { data: orders = [], isLoading } = usePurchaseOrders();
  const confirmMutation = useConfirmPurchaseOrder();
  const receiveMutation = useDocumentAction((id: string) => purchasingService.receivePurchaseOrder(id), {
    invalidate: ['purchase-orders', 'stock', 'products'], success: t('receiptValidated'), error: tc('error'),
  });
  const billMutation = useDocumentAction((id: string) => purchasingService.billPurchaseOrder(id), {
    invalidate: ['purchase-orders', 'purchase-invoices'], success: t('billCreated'), error: tc('error'),
  });
  const cancelMutation = useDocumentAction((id: string) => purchasingService.cancelPurchaseOrder(id), {
    invalidate: ['purchase-orders'], success: t('orderCancelled'), error: tc('error'),
  });
  const replenishMutation = useDocumentAction(() => purchasingService.generateReplenishment(), {
    invalidate: ['purchase-orders'], success: t('rfqsGenerated'), error: tc('error'),
  });

  const columns = [
    { key: 'orderNumber', header: t('orderNumber') },
    { key: 'date', header: tc('date') },
    { key: 'status', header: tc('status'), render: (item: PurchaseOrder) => <StatusBadge status={item.status} label={item.status === 'received' ? t('received') : tc(item.status)} /> },
    { key: 'totalAmount', header: tc('total'), render: (item: PurchaseOrder) => Number(item.totalAmount).toFixed(2) },
    {
      key: 'actions', header: tc('actions'),
      render: (item: PurchaseOrder) => (
        <div className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
          {['draft', 'sent'].includes(item.status) && (
            <button onClick={() => confirmMutation.mutate(item.id)} disabled={confirmMutation.isPending} className={`${ACTION_CLASS} text-primary-600`}>
              {t('confirmOrder')}
            </button>
          )}
          {item.status === 'confirmed' && (
            <button onClick={() => receiveMutation.mutate(item.id)} disabled={receiveMutation.isPending} className={`${ACTION_CLASS} text-blue-600`}>
              {t('receive')}
            </button>
          )}
          {['confirmed', 'received'].includes(item.status) && item.billStatus !== 'billed' && (
            <button onClick={() => billMutation.mutate(item.id)} disabled={billMutation.isPending} className={`${ACTION_CLASS} text-green-600`}>
              {t('createBill')}
            </button>
          )}
          {['draft', 'sent', 'confirmed'].includes(item.status) && (
            <button onClick={() => cancelMutation.mutate(item.id)} disabled={cancelMutation.isPending} className={`${ACTION_CLASS} text-red-600`}>
              {t('cancelOrder')}
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('orders')}
        action={{ label: t('generateRfqs'), onClick: () => replenishMutation.mutate(undefined) }}
      />
      <DataTable columns={columns} data={orders} loading={isLoading} searchable />
    </div>
  );
}
