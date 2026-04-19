'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import { useSalesOrders, useConfirmSalesOrder } from '@/hooks/use-sales';
import type { SalesOrder } from '@/types';

export default function SalesOrdersPage() {
  const t = useTranslations('sales');
  const tc = useTranslations('common');
  const router = useRouter();

  const { data: orders = [], isLoading } = useSalesOrders();
  const confirmMutation = useConfirmSalesOrder();

  const columns = [
    { key: 'orderNumber', header: t('orderNumber') },
    { key: 'date', header: tc('date') },
    { key: 'status', header: tc('status'), render: (item: SalesOrder) => <StatusBadge status={item.status} label={tc(item.status)} /> },
    { key: 'totalAmount', header: tc('total'), render: (item: SalesOrder) => Number(item.totalAmount).toFixed(2) },
    {
      key: 'actions', header: tc('actions'),
      render: (item: SalesOrder) => item.status === 'draft' ? (
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
      <DataTable columns={columns} data={orders} loading={isLoading} searchable onRowClick={(item) => router.push(`/sales/orders/${item.id}`)} />
    </div>
  );
}
