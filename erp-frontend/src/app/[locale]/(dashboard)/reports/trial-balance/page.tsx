'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useTrialBalance } from '@/hooks/use-dashboard';

export default function TrialBalancePage() {
  const t = useTranslations('reports');
  const tc = useTranslations('common');
  const ta = useTranslations('accounting');
  const today = new Date().toISOString().split('T')[0];
  const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(today);
  const [applied, setApplied] = useState({ from: firstOfMonth, to: today });

  const { data, isLoading } = useTrialBalance(applied.from, applied.to);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/reports" className="text-sm text-gray-500 hover:text-gray-700">← {t('title')}</Link>
        <h1 className="text-2xl font-bold text-gray-900">{t('trialBalance')}</h1>
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

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        {isLoading ? (
          <p className="text-center text-gray-500 py-8">{tc('loading')}</p>
        ) : !data ? (
          <p className="text-center text-gray-500 py-8">{tc('noData')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-start py-2 font-medium text-gray-600">{t('accountCode')}</th>
                <th className="text-start py-2 font-medium text-gray-600">{t('accountName')}</th>
                <th className="text-end py-2 font-medium text-gray-600">{ta('debit')}</th>
                <th className="text-end py-2 font-medium text-gray-600">{ta('credit')}</th>
                <th className="text-end py-2 font-medium text-gray-600">{t('balance')}</th>
              </tr>
            </thead>
            <tbody>
              {(data.accounts || []).map((acc: any) => (
                <tr key={acc.accountId} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="py-2 text-gray-500">{acc.code}</td>
                  <td className="py-2">{acc.name}</td>
                  <td className="py-2 text-end">{Number(acc.debit).toFixed(2)}</td>
                  <td className="py-2 text-end">{Number(acc.credit).toFixed(2)}</td>
                  <td className={`py-2 text-end font-medium ${Number(acc.balance) < 0 ? 'text-red-600' : ''}`}>{Number(acc.balance).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t font-bold bg-gray-50">
                <td colSpan={2} className="py-3 px-2">{tc('total')}</td>
                <td className="py-3 text-end">{Number(data.totalDebit || 0).toFixed(2)}</td>
                <td className="py-3 text-end">{Number(data.totalCredit || 0).toFixed(2)}</td>
                <td className="py-3 text-end">{(Number(data.totalDebit || 0) - Number(data.totalCredit || 0)).toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
