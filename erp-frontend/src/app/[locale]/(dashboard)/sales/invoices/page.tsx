'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import { salesService } from '@/services/sales.service';
import type { SalesInvoice } from '@/types';

export default function SalesInvoicesPage() {
  const t = useTranslations('sales');
  const tc = useTranslations('common');
  const [invoices, setInvoices] = useState<SalesInvoice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try { setInvoices(await salesService.getSalesInvoices()); }
    catch { /* handle */ }
    finally { setLoading(false); }
  };

  const handlePay = async (id: string) => {
    await salesService.markInvoicePaid(id);
    loadData();
  };

  const columns = [
    { key: 'invoiceNumber', header: t('invoiceNumber') },
    { key: 'date', header: tc('date') },
    { key: 'dueDate', header: t('dueDate') },
    { key: 'status', header: tc('status'), render: (item: SalesInvoice) => <StatusBadge status={item.status} label={tc(item.status)} /> },
    { key: 'totalAmount', header: tc('total'), render: (item: SalesInvoice) => Number(item.totalAmount).toFixed(2) },
    { key: 'paidAmount', header: tc('paid'), render: (item: SalesInvoice) => Number(item.paidAmount).toFixed(2) },
    {
      key: 'actions', header: tc('actions'),
      render: (item: SalesInvoice) => ['draft', 'sent', 'partial'].includes(item.status) ? (
        <button onClick={(e) => { e.stopPropagation(); handlePay(item.id); }} className="text-sm text-green-600 hover:underline">{t('markPaid')}</button>
      ) : null,
    },
  ];

  return (
    <div>
      <PageHeader title={t('invoices')} action={{ label: t('newInvoice'), onClick: () => {} }} />
      <DataTable columns={columns} data={invoices} loading={loading} />
    </div>
  );
}
