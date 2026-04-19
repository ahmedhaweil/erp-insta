'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useProfitLoss } from '@/hooks/use-dashboard';

export default function ProfitLossPage() {
  const t = useTranslations('reports');
  const tc = useTranslations('common');
  const today = new Date().toISOString().split('T')[0];
  const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(today);
  const [applied, setApplied] = useState({ from: firstOfMonth, to: today });

  const { data, isLoading } = useProfitLoss(applied.from, applied.to);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/reports" className="text-sm text-gray-500 hover:text-gray-700">← {t('title')}</Link>
        <h1 className="text-2xl font-bold text-gray-900">{t('profitLoss')}</h1>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{t('fromDate')}</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{t('toDate')}</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <button onClick={() => setApplied({ from, to })} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700">
            {t('generateReport')}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <p className="text-center text-gray-500 py-8">{tc('loading')}</p>
        </div>
      ) : !data ? (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <p className="text-center text-gray-500 py-8">{tc('noData')}</p>
        </div>
      ) : (
        <>
          {/* Revenue Section */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('revenue')}</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-start py-2 font-medium text-gray-600">{t('accountCode')}</th>
                  <th className="text-start py-2 font-medium text-gray-600">{t('accountName')}</th>
                  <th className="text-end py-2 font-medium text-gray-600">{tc('amount')}</th>
                </tr>
              </thead>
              <tbody>
                {(data.revenue || []).map((item: any) => (
                  <tr key={item.accountId} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="py-2 text-gray-500">{item.code}</td>
                    <td className="py-2">{item.name}</td>
                    <td className="py-2 text-end">{Number(item.amount).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t font-bold bg-gray-50">
                  <td colSpan={2} className="py-3 px-2">{t('totalRevenue')}</td>
                  <td className="py-3 text-end">{Number(data.totalRevenue || 0).toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Expenses Section */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('expenses')}</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-start py-2 font-medium text-gray-600">{t('accountCode')}</th>
                  <th className="text-start py-2 font-medium text-gray-600">{t('accountName')}</th>
                  <th className="text-end py-2 font-medium text-gray-600">{tc('amount')}</th>
                </tr>
              </thead>
              <tbody>
                {(data.expenses || []).map((item: any) => (
                  <tr key={item.accountId} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="py-2 text-gray-500">{item.code}</td>
                    <td className="py-2">{item.name}</td>
                    <td className="py-2 text-end">{Number(item.amount).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t font-bold bg-gray-50">
                  <td colSpan={2} className="py-3 px-2">{t('totalExpenses')}</td>
                  <td className="py-3 text-end">{Number(data.totalExpenses || 0).toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Summary */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="space-y-3 text-sm">
              <div className="flex justify-between py-2 border-b">
                <span className="font-medium text-gray-600">{t('totalRevenue')}</span>
                <span className="font-semibold">{Number(data.totalRevenue || 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between py-2 border-b">
                <span className="font-medium text-gray-600">{t('totalExpenses')}</span>
                <span className="font-semibold">{Number(data.totalExpenses || 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="font-bold text-gray-900">{t('netIncome')}</span>
                <span className={`font-bold text-lg ${Number(data.netIncome) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {Number(data.netIncome || 0).toFixed(2)}
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
