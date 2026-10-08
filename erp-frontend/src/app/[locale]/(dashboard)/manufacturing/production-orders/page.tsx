'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import Modal from '@/components/ui/Modal';
import { Checkbox, Field, FormActions, Input, Select, Toolbar, num, useMoney } from '@/components/people/ui';
import { useLabelMap, usePeopleMutation, usePeopleQuery, useProducts, useWarehouses } from '@/hooks/use-people';
import { mfgService, type ProductionOrder } from '@/services/people-manufacturing.service';

const STATUSES = ['draft', 'confirmed', 'in_progress', 'done', 'cancelled'];
const COLORS: Record<string, string> = { draft: 'draft', confirmed: 'confirmed', in_progress: 'pending', done: 'completed', cancelled: 'cancelled' };

export default function ProductionOrdersPage() {
  const t = useTranslations('mfg');
  const tc = useTranslations('common');
  const tp = useTranslations('people');
  const router = useRouter();
  const money = useMoney();
  const [filters, setFilters] = useState({ status: '', productId: '' });
  const { data = [], isLoading } = usePeopleQuery(['mfg-orders', filters], () => mfgService.orders(filters));
  const { data: products } = useProducts();
  const { data: warehouses } = useWarehouses();
  const { data: boms = [] } = usePeopleQuery(['mfg-boms', 'all'], () => mfgService.boms());
  const productMap = useLabelMap(products);
  const whMap = useLabelMap(warehouses);
  const blank = { productId: '', bomId: '', quantity: '1', sourceWarehouseId: '', destinationWarehouseId: '', plannedDate: '', explode: false, notes: '' };
  const [form, setForm] = useState(blank);
  const [open, setOpen] = useState(false);

  const create = usePeopleMutation(
    (body: typeof blank) => mfgService.createOrder({ ...body, quantity: Number(body.quantity), explode: body.explode || undefined }),
    { invalidate: ['mfg-orders'], success: t('orderCreated'), onSuccess: (o) => router.push(`/manufacturing/production-orders/${o.id}`) },
  );

  const productBoms = boms.filter((b) => b.productId === form.productId);
  const bomProductIds = new Set(boms.map((b) => b.productId));
  const set = (key: keyof typeof blank, value: string | boolean) => setForm((f) => ({ ...f, [key]: value }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(form);
  };

  return (
    <div>
      <PageHeader title={t('productionOrders')} action={{ label: t('newOrder'), onClick: () => { setForm(blank); setOpen(true); } }} />
      <Toolbar>
        <Field label={tc('status')}>
          <Select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} placeholder={tc('all')} options={STATUSES.map((s) => ({ value: s, label: t(`status_${s}`) }))} />
        </Field>
        <Field label={t('product')}>
          <Select value={filters.productId} onChange={(e) => setFilters((f) => ({ ...f, productId: e.target.value }))} placeholder={tc('all')} options={[...productMap].filter(([id]) => bomProductIds.has(id)).map(([value, label]) => ({ value, label }))} />
        </Field>
      </Toolbar>
      <DataTable<ProductionOrder>
        data={data}
        loading={isLoading}
        searchable
        onRowClick={(o) => router.push(`/manufacturing/production-orders/${o.id}`)}
        columns={[
          { key: 'orderNumber', header: t('orderNumber') },
          { key: 'productId', header: t('product'), render: (o) => productMap.get(o.productId) ?? o.product?.code },
          { key: 'plannedQuantity', header: t('planned'), render: (o) => num(o.plannedQuantity) },
          { key: 'producedQuantity', header: t('produced'), render: (o) => num(o.producedQuantity) },
          { key: 'sourceWarehouseId', header: t('sourceWarehouse'), render: (o) => whMap.get(o.sourceWarehouseId) },
          { key: 'plannedDate', header: t('plannedDate'), render: (o) => o.plannedDate ?? '-' },
          { key: 'standardUnitCost', header: t('standardUnitCost'), render: (o) => money(o.standardUnitCost, 4) },
          { key: 'status', header: tc('status'), render: (o) => <StatusBadge status={COLORS[o.status]} label={t(`status_${o.status}`)} /> },
        ]}
      />
      <Modal isOpen={open} onClose={() => setOpen(false)} title={t('newOrder')} size="lg">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label={t('product')} required>
              <Select
                required
                value={form.productId}
                onChange={(e) => setForm((f) => ({ ...f, productId: e.target.value, bomId: '' }))}
                placeholder={tp('select')}
                options={[...productMap].filter(([id]) => bomProductIds.has(id)).map(([value, label]) => ({ value, label }))}
              />
            </Field>
            <Field label={t('bom')} hint={t('bomDefaultHint')}>
              <Select
                value={form.bomId}
                onChange={(e) => set('bomId', e.target.value)}
                placeholder={t('activeBom')}
                options={productBoms.map((b) => ({ value: b.id, label: `${b.code} v${b.version}${b.isActive ? ` (${tc('active')})` : ''}` }))}
              />
            </Field>
            <Field label={tc('quantity')} required>
              <Input type="number" step="any" min="0.0001" required value={form.quantity} onChange={(e) => set('quantity', e.target.value)} />
            </Field>
            <Field label={t('plannedDate')}>
              <Input type="date" value={form.plannedDate} onChange={(e) => set('plannedDate', e.target.value)} />
            </Field>
            <Field label={t('sourceWarehouse')} required>
              <Select required value={form.sourceWarehouseId} onChange={(e) => set('sourceWarehouseId', e.target.value)} placeholder={tp('select')} options={[...whMap].map(([value, label]) => ({ value, label }))} />
            </Field>
            <Field label={t('destinationWarehouse')}>
              <Select value={form.destinationWarehouseId} onChange={(e) => set('destinationWarehouseId', e.target.value)} placeholder={t('sameAsSource')} options={[...whMap].map(([value, label]) => ({ value, label }))} />
            </Field>
          </div>
          <Checkbox label={t('explodeSubAssemblies')} checked={form.explode} onChange={(v) => set('explode', v)} />
          <Field label={tc('notes')}>
            <Input value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
          <FormActions onCancel={() => setOpen(false)} submitting={create.isPending} />
        </form>
      </Modal>
    </div>
  );
}
