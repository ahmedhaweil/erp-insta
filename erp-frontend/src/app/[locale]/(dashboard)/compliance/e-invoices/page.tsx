'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import { complianceService } from '@/services/compliance.service';
import type { EInvoice } from '@/types';

export default function EInvoicesPage() {
  const t = useTranslations('compliance');
  const tc = useTranslations('common');
  const [invoices, setInvoices] = useState<EInvoice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try { setInvoices(await complianceService.getEInvoices()); }
    catch { /* handle */ }
    finally { setLoading(false); }
  };

  const columns = [
    { key: 'invoiceId', header: tc('code') },
    { key: 'invoiceType', header: tc('status'), render: (item: EInvoice) => item.invoiceType === 'sales' ? tc('sales' as any) : tc('purchasing' as any) },
    { key: 'provider', header: t('country'), render: (item: EInvoice) => item.provider === 'eta' ? t('eta') : t('zatca') },
    { key: 'status', header: tc('status'), render: (item: EInvoice) => <StatusBadge status={item.status} label={t(item.status)} /> },
    { key: 'submittedAt', header: tc('date'), render: (item: EInvoice) => item.submittedAt || '-' },
  ];

  return (
    <div>
      <PageHeader title={t('eInvoices')} />
      <DataTable columns={columns} data={invoices} loading={loading} />
    </div>
  );
}
