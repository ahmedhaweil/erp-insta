'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import { purchasingService } from '@/services/purchasing.service';
import type { PurchaseOrder } from '@/types';

export default function PurchaseOrdersPage() {
  const t = useTranslations('purchasing');
  const tc = useTranslations('common');
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try { setOrders(await purchasingService.getPurchaseOrders()); }
    catch { /* handle */ }
    finally { setLoading(false); }
  };

  const handleConfirm = async (id: string) => {
    await purchasingService.confirmPurchaseOrder(id);
    loadData();
  };

  const columns = [
    { key: 'orderNumber', header: t('orderNumber') },
    { key: 'date', header: tc('date') },
    { key: 'status', header: tc('status'), render: (item: PurchaseOrder) => <StatusBadge status={item.status} label={item.status === 'received' ? t('received') : tc(item.status)} /> },
    { key: 'totalAmount', header: tc('total'), render: (item: PurchaseOrder) => Number(item.totalAmount).toFixed(2) },
    {
      key: 'actions', header: tc('actions'),
      render: (item: PurchaseOrder) => item.status === 'draft' ? (
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
