'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import { purchasingService } from '@/services/purchasing.service';
import type { PurchaseInvoice } from '@/types';

export default function PurchaseInvoicesPage() {
  const t = useTranslations('purchasing');
  const tc = useTranslations('common');
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try { setInvoices(await purchasingService.getPurchaseInvoices()); }
    catch { /* handle */ }
    finally { setLoading(false); }
  };

  const handleApprove = async (id: string) => {
    await purchasingService.approvePurchaseInvoice(id);
    loadData();
  };

  const handlePay = async (id: string) => {
    await purchasingService.markPurchaseInvoicePaid(id);
    loadData();
  };

  const columns = [
    { key: 'invoiceNumber', header: t('invoiceNumber') },
    { key: 'date', header: tc('date') },
    { key: 'status', header: tc('status'), render: (item: PurchaseInvoice) => <StatusBadge status={item.status} label={item.status === 'approved' ? t('approved') : tc(item.status)} /> },
    { key: 'totalAmount', header: tc('total'), render: (item: PurchaseInvoice) => Number(item.totalAmount).toFixed(2) },
    { key: 'paidAmount', header: tc('paid'), render: (item: PurchaseInvoice) => Number(item.paidAmount).toFixed(2) },
    {
      key: 'actions', header: tc('actions'),
      render: (item: PurchaseInvoice) => (
        <div className="flex gap-2">
          {item.status === 'draft' && <button onClick={(e) => { e.stopPropagation(); handleApprove(item.id); }} className="text-sm text-blue-600 hover:underline">{t('approveInvoice')}</button>}
          {['approved', 'partial'].includes(item.status) && <button onClick={(e) => { e.stopPropagation(); handlePay(item.id); }} className="text-sm text-green-600 hover:underline">{t('markPaid')}</button>}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title={t('invoices')} action={{ label: t('newInvoice'), onClick: () => {} }} />
      <DataTable columns={columns} data={invoices} loading={loading} />
    </div>
  );
}
