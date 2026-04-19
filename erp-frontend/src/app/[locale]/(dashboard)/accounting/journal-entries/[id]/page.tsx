'use client';

import { useParams } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useJournalEntry, usePostJournalEntry, useAccounts } from '@/hooks/use-accounting';
import StatusBadge from '@/components/ui/StatusBadge';

export default function JournalEntryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations('accounting');
  const tc = useTranslations('common');
  const locale = useLocale();

  const { data: entry, isLoading } = useJournalEntry(id);
  const { data: accounts = [] } = useAccounts();
  const postMutation = usePostJournalEntry();

  if (isLoading) return <div className="p-8 text-center text-gray-500">{tc('loading')}</div>;
  if (!entry) return <div className="p-8 text-center text-gray-500">{tc('noData')}</div>;

  const totalDebit = (entry.lines || []).reduce((s, l) => s + Number(l.debit), 0);
  const totalCredit = (entry.lines || []).reduce((s, l) => s + Number(l.credit), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

  const getAccountName = (accountId: string) => {
    const a = accounts.find(a => a.id === accountId);
    return a ? (locale === 'ar' ? a.nameAr : (a.nameEn || a.nameAr)) : accountId;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/accounting/journal-entries" className="text-sm text-gray-500 hover:text-gray-700">← {tc('back')}</Link>
          <h1 className="text-2xl font-bold text-gray-900">{t('refNumber')}: {entry.refNumber}</h1>
          <StatusBadge status={entry.status} label={tc(entry.status)} />
        </div>
        {entry.status === 'draft' && (
          <button
            onClick={() => postMutation.mutate(entry.id)}
            disabled={postMutation.isPending || !isBalanced}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 disabled:opacity-50"
          >
            {postMutation.isPending ? tc('loading') : t('postEntry')}
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="grid grid-cols-3 gap-6 mb-6">
          <div><p className="text-xs text-gray-500 mb-1">{tc('date')}</p><p className="text-sm font-medium">{entry.date}</p></div>
          <div><p className="text-xs text-gray-500 mb-1">{tc('description')}</p><p className="text-sm font-medium">{entry.description}</p></div>
          <div><p className="text-xs text-gray-500 mb-1">{tc('status')}</p><StatusBadge status={entry.status} label={tc(entry.status)} /></div>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-start py-2 font-medium text-gray-600">{t('accountCode')}</th>
              <th className="text-start py-2 font-medium text-gray-600">{tc('name')}</th>
              <th className="text-end py-2 font-medium text-gray-600">{t('debit')}</th>
              <th className="text-end py-2 font-medium text-gray-600">{t('credit')}</th>
            </tr>
          </thead>
          <tbody>
            {(entry.lines || []).map((line, i) => (
              <tr key={line.id || i} className="border-b last:border-0">
                <td className="py-2 text-gray-500">{accounts.find(a => a.id === line.accountId)?.code}</td>
                <td className="py-2">{getAccountName(line.accountId)}</td>
                <td className="py-2 text-end">{Number(line.debit) > 0 ? Number(line.debit).toFixed(2) : '-'}</td>
                <td className="py-2 text-end">{Number(line.credit) > 0 ? Number(line.credit).toFixed(2) : '-'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t font-bold">
              <td colSpan={2} className="py-2">{t('totalDebit')} / {t('totalCredit')}</td>
              <td className="py-2 text-end">{totalDebit.toFixed(2)}</td>
              <td className="py-2 text-end">{totalCredit.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>

        <div className={`mt-4 p-3 rounded-lg text-sm font-medium ${isBalanced ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {isBalanced ? t('balanced') : t('unbalanced')}
        </div>
      </div>
    </div>
  );
}
