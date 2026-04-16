'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import StatCard from '@/components/ui/StatCard';
import StatusBadge from '@/components/ui/StatusBadge';
import { DollarSign, TrendingUp, TrendingDown, ShoppingCart, AlertTriangle } from 'lucide-react';
import { useDashboard } from '@/hooks/use-dashboard';

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const router = useRouter();
  const { data, isLoading } = useDashboard();

  const revenue = data?.totalRevenue ?? 0;
  const expenses = data?.totalExpenses ?? 0;
  const netProfit = data?.netProfit ?? 0;
  const pendingOrders = data?.pendingOrders ?? 0;
  const lowStock = data?.lowStockProducts ?? 0;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">{t('title')}</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          title={t('totalRevenue')}
          value={isLoading ? '...' : revenue.toFixed(2)}
          icon={<DollarSign size={24} />}
          color="green"
        />
        <StatCard
          title={t('totalExpenses')}
          value={isLoading ? '...' : expenses.toFixed(2)}
          icon={<TrendingDown size={24} />}
          color="red"
        />
        <StatCard
          title={t('netProfit')}
          value={isLoading ? '...' : netProfit.toFixed(2)}
          icon={<TrendingUp size={24} />}
          color="primary"
        />
        <StatCard
          title={t('pendingOrders')}
          value={isLoading ? '...' : String(pendingOrders)}
          icon={<ShoppingCart size={24} />}
          color="yellow"
        />
      </div>

      {lowStock > 0 && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
          <span className="text-sm text-amber-800">
            {lowStock} {lowStock === 1 ? 'product is' : 'products are'} below reorder level
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('recentActivity')}</h2>
          {isLoading ? (
            <p className="text-sm text-gray-500">{t('welcome')}</p>
          ) : data?.recentOrders?.length ? (
            <div className="space-y-3">
              {data.recentOrders.map((order: any) => (
                <div
                  key={order.id}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition"
                  onClick={() => router.push(`/sales/orders`)}
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">{order.orderNumber}</p>
                    <p className="text-xs text-gray-500">{order.customerName}</p>
                  </div>
                  <div className="text-end">
                    <p className="text-sm font-medium">{Number(order.totalAmount).toFixed(2)}</p>
                    <StatusBadge status={order.status} label={order.status} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">{t('welcome')}</p>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('quickActions')}</h2>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => router.push('/sales/orders')}
              className="p-3 text-sm bg-gray-50 hover:bg-primary-50 hover:text-primary-600 rounded-lg transition text-start"
            >
              {t('pendingOrders')}
            </button>
            <button
              onClick={() => router.push('/purchasing/orders')}
              className="p-3 text-sm bg-gray-50 hover:bg-primary-50 hover:text-primary-600 rounded-lg transition text-start"
            >
              {t('pendingOrders')}
            </button>
            <button
              onClick={() => router.push('/accounting/journal-entries')}
              className="p-3 text-sm bg-gray-50 hover:bg-primary-50 hover:text-primary-600 rounded-lg transition text-start"
            >
              {t('recentActivity')}
            </button>
            <button
              onClick={() => router.push('/pos')}
              className="p-3 text-sm bg-gray-50 hover:bg-primary-50 hover:text-primary-600 rounded-lg transition text-start"
            >
              {t('quickActions')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
