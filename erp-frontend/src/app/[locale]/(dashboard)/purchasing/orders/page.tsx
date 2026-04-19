'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import { usePurchaseOrders, useConfirmPurchaseOrder } from '@/hooks/use-purchasing';
import type { PurchaseOrder } from '@/types';

export default function PurchaseOrdersPage() {
  const t = useTranslations('purchasing');
  const tc = useTranslations('common');
  const router = useRouter();

  const { data: orders = [], isLoading } = usePurchaseOrders();
  const confirmMutation = useConfirmPurchaseOrder();

  const columns = [
    { key: 'orderNumber', header: t('orderNumber') },
    { key: 'date', header: tc('date') },
    { key: 'status', header: tc('status'), render: (item: PurchaseOrder) => <StatusBadge status={item.status} label={item.status === 'received' ? t('received') : tc(item.status)} /> },
    { key: 'totalAmount', header: tc('total'), render: (item: PurchaseOrder) => Number(item.totalAmount).toFixed(2) },
    {
      key: 'actions', header: tc('actions'),
      render: (item: PurchaseOrder) => item.status === 'draft' ? (
        <button
          onClick={(e) => { e.stopPropagation(); confirmMutation.mutate(item.id); }}
          disabled={confirmMutation.isPending}
          className="text-sm text-primary-600 hover:underline disabled:opacity-50"
        >
          {t('confirmOrder')}
        </button>
      ) : null,
    },
  ];

  return (
    <div>
      <PageHeader title={t('orders')} action={{ label: t('newOrder'), onClick: () => {} }} />
      <DataTable columns={columns} data={orders} loading={isLoading} searchable onRowClick={(item) => router.push(`/purchasing/orders/${item.id}`)} />
    </div>
  );
}
