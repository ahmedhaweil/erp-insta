'use client';

import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import { useSalesInvoices, useMarkInvoicePaid } from '@/hooks/use-sales';
import type { SalesInvoice } from '@/types';

export default function SalesInvoicesPage() {
  const t = useTranslations('sales');
  const tc = useTranslations('common');

  const { data: invoices = [], isLoading } = useSalesInvoices();
  const payMutation = useMarkInvoicePaid();

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
        <button
          onClick={(e) => { e.stopPropagation(); payMutation.mutate(item.id); }}
          disabled={payMutation.isPending}
          className="text-sm text-green-600 hover:underline disabled:opacity-50"
        >
          {t('markPaid')}
        </button>
      ) : null,
    },
  ];

  return (
    <div>
      <PageHeader title={t('invoices')} action={{ label: t('newInvoice'), onClick: () => {} }} />
      <DataTable columns={columns} data={invoices} loading={isLoading} searchable />
    </div>
  );
}
