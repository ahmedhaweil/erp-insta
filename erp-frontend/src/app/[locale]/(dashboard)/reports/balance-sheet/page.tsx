'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useBalanceSheet } from '@/hooks/use-dashboard';
import { CheckCircle, AlertTriangle } from 'lucide-react';

export default function BalanceSheetPage() {
  const t = useTranslations('reports');
  const tc = useTranslations('common');
  const today = new Date().toISOString().split('T')[0];
  const [asOf, setAsOf] = useState(today);
  const [applied, setApplied] = useState({ asOf: today });

  const { data, isLoading } = useBalanceSheet(applied.asOf);

  const balanced = data
    ? Math.abs(Number(data.totalAssets || 0) - Number(data.totalLiabilitiesAndEquity || 0)) < 0.01
    : false;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/reports" className="text-sm text-gray-500 hover:text-gray-700">← {t('title')}</Link>
        <h1 className="text-2xl font-bold text-gray-900">{t('balanceSheet')}</h1>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{t('asOfDate')}</label>
            <input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <button onClick={() => setApplied({ asOf })} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700">
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
          {/* Assets Section */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('assets')}</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-start py-2 font-medium text-gray-600">{t('accountCode')}</th>
                  <th className="text-start py-2 font-medium text-gray-600">{t('accountName')}</th>
                  <th className="text-end py-2 font-medium text-gray-600">{t('balance')}</th>
                </tr>
              </thead>
              <tbody>
                {(data.assets || []).map((item: any) => (
                  <tr key={item.accountId} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="py-2 text-gray-500">{item.code}</td>
                    <td className="py-2">{item.name}</td>
                    <td className="py-2 text-end">{Number(item.balance).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t font-bold bg-gray-50">
                  <td colSpan={2} className="py-3 px-2">{t('totalAssets')}</td>
                  <td className="py-3 text-end">{Number(data.totalAssets || 0).toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Liabilities Section */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('liabilities')}</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-start py-2 font-medium text-gray-600">{t('accountCode')}</th>
                  <th className="text-start py-2 font-medium text-gray-600">{t('accountName')}</th>
                  <th className="text-end py-2 font-medium text-gray-600">{t('balance')}</th>
                </tr>
              </thead>
              <tbody>
                {(data.liabilities || []).map((item: any) => (
                  <tr key={item.accountId} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="py-2 text-gray-500">{item.code}</td>
                    <td className="py-2">{item.name}</td>
                    <td className="py-2 text-end">{Number(item.balance).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Equity Section */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('equity')}</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-start py-2 font-medium text-gray-600">{t('accountCode')}</th>
                  <th className="text-start py-2 font-medium text-gray-600">{t('accountName')}</th>
                  <th className="text-end py-2 font-medium text-gray-600">{t('balance')}</th>
                </tr>
              </thead>
              <tbody>
                {(data.equity || []).map((item: any) => (
                  <tr key={item.accountId} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="py-2 text-gray-500">{item.code}</td>
                    <td className="py-2">{item.name}</td>
                    <td className="py-2 text-end">{Number(item.balance).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Summary */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="space-y-3 text-sm">
              <div className="flex justify-between py-2 border-b">
                <span className="font-bold text-gray-900">{t('totalAssets')}</span>
                <span className="font-bold">{Number(data.totalAssets || 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between py-2 border-b">
                <span className="font-bold text-gray-900">{t('totalLiabilities')} + {t('totalEquity')}</span>
                <span className="font-bold">{Number(data.totalLiabilitiesAndEquity || 0).toFixed(2)}</span>
              </div>
              <div className="flex items-center gap-2 py-2">
                {balanced ? (
                  <>
                    <CheckCircle size={18} className="text-green-600" />
                    <span className="text-green-600 font-medium">Balanced</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle size={18} className="text-red-600" />
                    <span className="text-red-600 font-medium">Not Balanced</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
