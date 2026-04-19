'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { BarChart3, TrendingUp, Scale } from 'lucide-react';

export default function ReportsPage() {
  const t = useTranslations('reports');

  const reports = [
    { key: 'trialBalance', href: '/reports/trial-balance', icon: <Scale size={32} />, color: 'bg-blue-50 text-blue-600' },
    { key: 'profitLoss', href: '/reports/profit-loss', icon: <TrendingUp size={32} />, color: 'bg-green-50 text-green-600' },
    { key: 'balanceSheet', href: '/reports/balance-sheet', icon: <BarChart3 size={32} />, color: 'bg-purple-50 text-purple-600' },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">{t('title')}</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {reports.map(r => (
          <Link key={r.key} href={r.href} className="bg-white rounded-xl border border-gray-200 p-6 hover:border-primary-300 hover:shadow-md transition block">
            <div className={`w-14 h-14 rounded-xl flex items-center justify-center mb-4 ${r.color}`}>{r.icon}</div>
            <h2 className="text-lg font-semibold text-gray-900">{t(r.key as any)}</h2>
          </Link>
        ))}
      </div>
    </div>
  );
}
