'use client';

import { useTranslations } from 'next-intl';
import StatCard from '@/components/ui/StatCard';
import { DollarSign, TrendingUp, TrendingDown, ShoppingCart } from 'lucide-react';

export default function DashboardPage() {
  const t = useTranslations('dashboard');

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">{t('title')}</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          title={t('totalRevenue')}
          value="0.00"
          icon={<DollarSign size={24} />}
          color="green"
        />
        <StatCard
          title={t('totalExpenses')}
          value="0.00"
          icon={<TrendingDown size={24} />}
          color="red"
        />
        <StatCard
          title={t('netProfit')}
          value="0.00"
          icon={<TrendingUp size={24} />}
          color="primary"
        />
        <StatCard
          title={t('pendingOrders')}
          value="0"
          icon={<ShoppingCart size={24} />}
          color="yellow"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('recentActivity')}</h2>
          <p className="text-sm text-gray-500">{t('welcome')}</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('quickActions')}</h2>
          <div className="grid grid-cols-2 gap-3">
            {['salesOrders', 'purchaseOrders', 'journalEntries', 'pos'].map((action) => (
              <button
                key={action}
                className="p-3 text-sm bg-gray-50 hover:bg-primary-50 hover:text-primary-600 rounded-lg transition text-start"
              >
                {action === 'salesOrders' && t('pendingOrders')}
                {action === 'purchaseOrders' && t('pendingOrders')}
                {action === 'journalEntries' && t('recentActivity')}
                {action === 'pos' && t('quickActions')}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
