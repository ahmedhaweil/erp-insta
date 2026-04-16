'use client';

import { useTranslations, useLocale } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import { useWarehouses } from '@/hooks/use-products';
import type { Warehouse } from '@/types';

export default function WarehousesPage() {
  const t = useTranslations('inventory');
  const tc = useTranslations('common');
  const locale = useLocale();

  const { data: warehouses = [], isLoading } = useWarehouses();

  const columns = [
    { key: 'code', header: tc('code') },
    {
      key: 'name', header: tc('name'),
      render: (item: Warehouse) => locale === 'ar' ? item.nameAr : (item.nameEn || item.nameAr),
    },
    {
      key: 'isActive', header: tc('status'),
      render: (item: Warehouse) => <StatusBadge status={item.isActive ? 'active' : 'inactive'} label={item.isActive ? tc('active') : tc('inactive')} />,
    },
  ];

  return (
    <div>
      <PageHeader title={t('warehouses')} action={{ label: t('newWarehouse'), onClick: () => {} }} />
      <DataTable columns={columns} data={warehouses} loading={isLoading} searchable />
    </div>
  );
}
