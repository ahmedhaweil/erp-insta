'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { Field, FormActions, Input, Select, num, todayIso, useMoney } from '@/components/people/ui';
import { useLabelMap, usePeopleMutation, usePeopleQuery, useProducts, useWarehouses } from '@/hooks/use-people';
import { mfgService, type ScrapRecord } from '@/services/people-manufacturing.service';

export default function ScrapsPage() {
  const t = useTranslations('mfg');
  const tc = useTranslations('common');
  const tp = useTranslations('people');
  const money = useMoney();
  const { data = [], isLoading } = usePeopleQuery(['mfg-scraps', 'all'], () => mfgService.scraps());
  const { data: orders = [] } = usePeopleQuery(['mfg-orders', 'all'], () => mfgService.orders());
  const { data: products } = useProducts();
  const { data: warehouses } = useWarehouses();
  const labels = useLabelMap(products);
  const whMap = useLabelMap(warehouses);
  const orderMap = new Map(orders.map((o) => [o.id, o.orderNumber]));
  const blank = { productionOrderId: '', productId: '', warehouseId: '', quantity: '1', date: todayIso(), reason: '' };
  const [form, setForm] = useState(blank);
  const [open, setOpen] = useState(false);
  const create = usePeopleMutation((body: typeof blank) => mfgService.createScrap({ ...body, quantity: Number(body.quantity) }), {
    invalidate: ['mfg-scraps', 'mfg-orders'],
    success: t('scrapRecorded'),
    onSuccess: () => setOpen(false),
  });
  const set = (key: keyof typeof blank, value: string) => setForm((f) => ({ ...f, [key]: value }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(form);
  };
  const openOrders = orders.filter((o) => ['confirmed', 'in_progress', 'done'].includes(o.status));

  return (
    <div>
      <PageHeader title={t('scraps')} action={{ label: t('recordScrap'), onClick: () => { setForm(blank); setOpen(true); } }} />
      <DataTable<ScrapRecord>
        data={data}
        loading={isLoading}
        searchable
        columns={[
          { key: 'scrapNumber', header: t('scrapNumber') },
          { key: 'date', header: tc('date'), render: (s) => String(s.date).slice(0, 10) },
          { key: 'productionOrderId', header: t('productionOrder'), render: (s) => (s.productionOrderId ? orderMap.get(s.productionOrderId) : '-') },
          { key: 'productId', header: t('product'), render: (s) => labels.get(s.productId) },
          { key: 'warehouseId', header: t('warehouse'), render: (s) => whMap.get(s.warehouseId) },
          { key: 'quantity', header: tc('quantity'), render: (s) => num(s.quantity) },
          { key: 'unitCost', header: t('unitCost'), render: (s) => money(s.unitCost, 4) },
          { key: 'cost', header: t('cost'), render: (s) => money(s.cost) },
          { key: 'reason', header: t('reason'), render: (s) => s.reason || '-' },
        ]}
      />
      <Modal isOpen={open} onClose={() => setOpen(false)} title={t('recordScrap')}>
        <form onSubmit={submit} className="space-y-4">
          <Field label={t('productionOrder')}>
            <Select value={form.productionOrderId} onChange={(e) => set('productionOrderId', e.target.value)} placeholder={tp('none')} options={openOrders.map((o) => ({ value: o.id, label: `${o.orderNumber} - ${labels.get(o.productId) ?? ''}` }))} />
          </Field>
          <Field label={t('product')} required>
            <Select required value={form.productId} onChange={(e) => set('productId', e.target.value)} placeholder={tp('select')} options={[...labels].map(([value, label]) => ({ value, label }))} />
          </Field>
          <Field label={t('warehouse')} required={!form.productionOrderId} hint={t('scrapWarehouseHint')}>
            <Select required={!form.productionOrderId} value={form.warehouseId} onChange={(e) => set('warehouseId', e.target.value)} placeholder={tp('select')} options={[...whMap].map(([value, label]) => ({ value, label }))} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label={tc('quantity')} required>
              <Input type="number" step="any" min="0.0001" required value={form.quantity} onChange={(e) => set('quantity', e.target.value)} />
            </Field>
            <Field label={tc('date')}>
              <Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
            </Field>
          </div>
          <Field label={t('reason')}>
            <Input value={form.reason} onChange={(e) => set('reason', e.target.value)} />
          </Field>
          <FormActions onCancel={() => setOpen(false)} submitting={create.isPending} />
        </form>
      </Modal>
    </div>
  );
}
