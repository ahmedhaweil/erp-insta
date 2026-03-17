'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import { salesService } from '@/services/sales.service';
import type { SalesOrder } from '@/types';

export default function SalesOrdersPage() {
  const t = useTranslations('sales');
  const tc = useTranslations('common');
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try { setOrders(await salesService.getSalesOrders()); }
    catch { /* handle */ }
    finally { setLoading(false); }
  };

  const handleConfirm = async (id: string) => {
    await salesService.confirmSalesOrder(id);
    loadData();
  };

  const columns = [
    { key: 'orderNumber', header: t('orderNumber') },
    { key: 'date', header: tc('date') },
    { key: 'status', header: tc('status'), render: (item: SalesOrder) => <StatusBadge status={item.status} label={tc(item.status)} /> },
    { key: 'totalAmount', header: tc('total'), render: (item: SalesOrder) => Number(item.totalAmount).toFixed(2) },
    {
      key: 'actions', header: tc('actions'),
      render: (item: SalesOrder) => item.status === 'draft' ? (
        <button onClick={(e) => { e.stopPropagation(); handleConfirm(item.id); }} className="text-sm text-primary-600 hover:underline">{t('confirmOrder')}</button>
      ) : null,
    },
  ];

  return (
    <div>
      <PageHeader title={t('orders')} action={{ label: t('newOrder'), onClick: () => {} }} />
      <DataTable columns={columns} data={orders} loading={loading} />
    </div>
  );
}
