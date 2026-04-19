'use client';

import { useParams } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useSalesInvoice, useMarkInvoicePaid } from '@/hooks/use-sales';
import { useCustomers } from '@/hooks/use-customers';
import { useProducts } from '@/hooks/use-products';
import StatusBadge from '@/components/ui/StatusBadge';

export default function SalesInvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations('sales');
  const tc = useTranslations('common');
  const locale = useLocale();

  const { data: invoice, isLoading } = useSalesInvoice(id);
  const { data: customers = [] } = useCustomers();
  const { data: products = [] } = useProducts();
  const payMutation = useMarkInvoicePaid();

  if (isLoading) return <div className="p-8 text-center text-gray-500">{tc('loading')}</div>;
  if (!invoice) return <div className="p-8 text-center text-gray-500">{tc('noData')}</div>;

  const customer = customers.find(c => c.id === invoice.customerId);
  const customerName = customer ? (locale === 'ar' ? customer.nameAr : (customer.nameEn || customer.nameAr)) : invoice.customerId;

  const getProductName = (productId: string) => {
    const p = products.find(p => p.id === productId);
    return p ? (locale === 'ar' ? p.nameAr : (p.nameEn || p.nameAr)) : productId;
  };

  const remainingBalance = Number(invoice.totalAmount) - Number(invoice.paidAmount);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/sales/invoices" className="text-sm text-gray-500 hover:text-gray-700">← {tc('back')}</Link>
          <h1 className="text-2xl font-bold text-gray-900">{t('invoiceNumber')}: {invoice.invoiceNumber}</h1>
          <StatusBadge status={invoice.status} label={tc(invoice.status)} />
        </div>
        <div className="flex gap-2">
          {['draft', 'sent', 'partial'].includes(invoice.status) && (
            <button
              onClick={() => payMutation.mutate(invoice.id)}
              disabled={payMutation.isPending}
              className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50"
            >
              {payMutation.isPending ? tc('loading') : t('markPaid')}
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold mb-4">{tc('details')}</h2>
        <div className="grid grid-cols-3 gap-6">
          <div><p className="text-xs text-gray-500 mb-1">{t('customers')}</p><p className="text-sm font-medium">{customerName}</p></div>
          <div><p className="text-xs text-gray-500 mb-1">{tc('date')}</p><p className="text-sm font-medium">{invoice.date}</p></div>
          <div><p className="text-xs text-gray-500 mb-1">{t('dueDate')}</p><p className="text-sm font-medium">{invoice.dueDate}</p></div>
          <div><p className="text-xs text-gray-500 mb-1">{tc('status')}</p><StatusBadge status={invoice.status} label={tc(invoice.status)} /></div>
          <div><p className="text-xs text-gray-500 mb-1">{tc('paid')}</p><p className="text-sm font-medium">{Number(invoice.paidAmount).toFixed(2)}</p></div>
          <div><p className="text-xs text-gray-500 mb-1">{tc('balance')}</p><p className="text-sm font-medium">{remainingBalance.toFixed(2)}</p></div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold mb-4">{tc('description')}</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-start py-2 font-medium text-gray-600">{t('product')}</th>
              <th className="text-end py-2 font-medium text-gray-600">{tc('quantity')}</th>
              <th className="text-end py-2 font-medium text-gray-600">{t('unitPrice')}</th>
              <th className="text-end py-2 font-medium text-gray-600">{tc('discount')}</th>
              <th className="text-end py-2 font-medium text-gray-600">{t('taxRate')}</th>
              <th className="text-end py-2 font-medium text-gray-600">{t('lineTotal')}</th>
            </tr>
          </thead>
          <tbody>
            {(invoice.lines || []).map((line, i) => (
              <tr key={line.id || i} className="border-b last:border-0">
                <td className="py-2">{getProductName(line.productId)}</td>
                <td className="py-2 text-end">{line.quantity}</td>
                <td className="py-2 text-end">{Number(line.unitPrice).toFixed(2)}</td>
                <td className="py-2 text-end">{line.discount || 0}%</td>
                <td className="py-2 text-end">{line.taxRate || 0}%</td>
                <td className="py-2 text-end font-medium">{Number(line.lineTotal).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 border-t pt-4 space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-gray-600">{tc('subtotal')}</span><span>{Number(invoice.subtotal).toFixed(2)}</span></div>
          <div className="flex justify-between"><span className="text-gray-600">{tc('tax')}</span><span>{Number(invoice.taxAmount).toFixed(2)}</span></div>
          <div className="flex justify-between font-bold text-base border-t pt-2"><span>{tc('total')}</span><span>{Number(invoice.totalAmount).toFixed(2)}</span></div>
          <div className="flex justify-between"><span className="text-gray-600">{tc('paid')}</span><span className="text-green-600">{Number(invoice.paidAmount).toFixed(2)}</span></div>
          <div className="flex justify-between font-semibold"><span className="text-gray-700">{tc('balance')}</span><span className={remainingBalance > 0 ? 'text-red-600' : 'text-green-600'}>{remainingBalance.toFixed(2)}</span></div>
        </div>
      </div>
    </div>
  );
}
