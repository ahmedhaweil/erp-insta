'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import { accountingService } from '@/services/accounting.service';
import type { JournalEntry } from '@/types';

export default function JournalEntriesPage() {
  const t = useTranslations('accounting');
  const tc = useTranslations('common');
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadEntries();
  }, []);

  const loadEntries = async () => {
    try {
      const data = await accountingService.getJournalEntries();
      setEntries(data);
    } catch {
      // handle error
    } finally {
      setLoading(false);
    }
  };

  const handlePost = async (id: string) => {
    try {
      await accountingService.postJournalEntry(id);
      loadEntries();
    } catch {
      // handle error
    }
  };

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
            onClick={(e) => { e.stopPropagation(); handlePost(item.id); }}
            className="text-sm text-primary-600 hover:underline"
          >
            {t('postEntry')}
          </button>
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader title={t('journalEntries')} />
      <DataTable columns={columns} data={entries} loading={loading} />
    </div>
  );
}
