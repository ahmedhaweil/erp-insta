'use client';

import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import { useJournalEntries, usePostJournalEntry } from '@/hooks/use-accounting';
import type { JournalEntry } from '@/types';

export default function JournalEntriesPage() {
  const t = useTranslations('accounting');
  const tc = useTranslations('common');

  const { data: entries = [], isLoading } = useJournalEntries();
  const postEntry = usePostJournalEntry();

  const columns = [
    { key: 'refNumber', header: t('refNumber') },
    { key: 'date', header: tc('date') },
    { key: 'description', header: tc('description') },
    {
      key: 'status',
      header: tc('status'),
      render: (item: JournalEntry) => (
        <StatusBadge status={item.status} label={tc(item.status)} />
      ),
    },
    {
      key: 'total',
      header: t('totalDebit'),
      render: (item: JournalEntry) =>
        item.lines?.reduce((sum, l) => sum + Number(l.debit), 0).toFixed(2),
    },
    {
      key: 'actions',
      header: tc('actions'),
      render: (item: JournalEntry) =>
        item.status === 'draft' ? (
          <button
            onClick={(e) => { e.stopPropagation(); postEntry.mutate(item.id); }}
            disabled={postEntry.isPending}
            className="text-sm text-primary-600 hover:underline disabled:opacity-50"
          >
            {t('postEntry')}
          </button>
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader title={t('journalEntries')} />
      <DataTable columns={columns} data={entries} loading={isLoading} searchable />
    </div>
  );
}
