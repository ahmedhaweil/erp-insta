'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import { usePurchaseInvoices, useApprovePurchaseInvoice, useMarkPurchaseInvoicePaid } from '@/hooks/use-purchasing';
import type { PurchaseInvoice } from '@/types';

export default function PurchaseInvoicesPage() {
  const t = useTranslations('purchasing');
  const tc = useTranslations('common');
  const router = useRouter();

  const { data: invoices = [], isLoading } = usePurchaseInvoices();
  const approveMutation = useApprovePurchaseInvoice();
  const payMutation = useMarkPurchaseInvoicePaid();

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
          {item.status === 'draft' && (
            <button
              onClick={(e) => { e.stopPropagation(); approveMutation.mutate(item.id); }}
              disabled={approveMutation.isPending}
              className="text-sm text-blue-600 hover:underline disabled:opacity-50"
            >
              {t('approveInvoice')}
            </button>
          )}
          {['approved', 'partial'].includes(item.status) && (
            <button
              onClick={(e) => { e.stopPropagation(); payMutation.mutate(item.id); }}
              disabled={payMutation.isPending}
              className="text-sm text-green-600 hover:underline disabled:opacity-50"
            >
              {t('markPaid')}
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title={t('invoices')} action={{ label: t('newInvoice'), onClick: () => {} }} />
      <DataTable columns={columns} data={invoices} loading={isLoading} searchable onRowClick={(item) => router.push(`/purchasing/invoices/${item.id}`)} />
    </div>
  );
}
