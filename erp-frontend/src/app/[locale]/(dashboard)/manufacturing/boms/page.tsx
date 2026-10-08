'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import { Checkbox, Field, Select, Toolbar, num, useMoney } from '@/components/people/ui';
import { useLabelMap, usePeopleQuery, useProducts } from '@/hooks/use-people';
import { mfgService, type Bom } from '@/services/people-manufacturing.service';

export default function BomsPage() {
  const t = useTranslations('mfg');
  const tc = useTranslations('common');
  const router = useRouter();
  const money = useMoney();
  const [productId, setProductId] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);
  const { data = [], isLoading } = usePeopleQuery(['mfg-boms', productId, activeOnly], () => mfgService.boms({ productId: productId || undefined, active: activeOnly }));
  const { data: products } = useProducts();
  const productMap = useLabelMap(products);

  return (
    <div>
      <PageHeader title={t('boms')} action={{ label: t('newBom'), onClick: () => router.push('/manufacturing/boms/new') }} />
      <Toolbar>
        <Field label={t('product')}>
          <Select value={productId} onChange={(e) => setProductId(e.target.value)} placeholder={tc('all')} options={[...productMap].map(([value, label]) => ({ value, label }))} />
        </Field>
        <Checkbox label={t('activeOnly')} checked={activeOnly} onChange={setActiveOnly} />
      </Toolbar>
      <DataTable<Bom>
        data={data}
        loading={isLoading}
        searchable
        onRowClick={(b) => router.push(`/manufacturing/boms/${b.id}`)}
        columns={[
          { key: 'code', header: tc('code') },
          { key: 'name', header: tc('name'), render: (b) => b.name || '-' },
          { key: 'productId', header: t('product'), render: (b) => productMap.get(b.productId) ?? b.product?.code },
          { key: 'version', header: t('version'), render: (b) => `v${b.version}` },
          { key: 'outputQuantity', header: t('outputQuantity'), render: (b) => num(b.outputQuantity) },
          { key: 'lines', header: t('componentsCount'), render: (b) => b.lines?.filter((l) => l.type === 'component').length ?? 0 },
          { key: 'labourCostPerUnit', header: t('labourPerUnit'), render: (b) => money(b.labourCostPerUnit) },
          { key: 'overheadCostPerUnit', header: t('overheadPerUnit'), render: (b) => money(b.overheadCostPerUnit) },
          { key: 'isActive', header: tc('status'), render: (b) => <StatusBadge status={b.isActive ? 'active' : 'inactive'} label={b.isActive ? tc('active') : tc('inactive')} /> },
        ]}
      />
    </div>
  );
}
