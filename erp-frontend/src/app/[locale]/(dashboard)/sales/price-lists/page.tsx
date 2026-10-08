'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { Btn, EntityForm, Field, inputCls, SelectBox, toOptions, type FieldDef } from '@/components/operations/form';
import { byId, Card, DetailGrid, fmtDate, fmtMoney, fmtQty, RowAction, RowActions, SimpleTable, Status, today, useModal, useNamer } from '@/components/operations/common';
import { useOpsCategories, useOpsCustomers, useOpsMutation, useOpsPriceLists, useOpsProducts, useOpsQuery } from '@/hooks/use-operations';
import { opsSales } from '@/services/operations-sales.service';
import type { Row } from '@/services/operations-api';

export default function PriceListsPage() {
  const t = useTranslations('ops');
  const { data: lists = [], isLoading } = useOpsPriceLists();
  const form = useModal<Row>();
  const rules = useModal<Row>();
  const save = useOpsMutation(
    (body: any) => (form.data ? opsSales.updatePriceList(form.data.id, body) : opsSales.createPriceList(body)),
    { invalidate: ['price-lists'], onSuccess: () => form.close() },
  );
  const fields: FieldDef[] = [
    { name: 'name', label: t('common.name'), required: true, wide: true },
    { name: 'validFrom', label: t('sales.validFrom'), type: 'date' },
    { name: 'validTo', label: t('sales.validTo'), type: 'date' },
    { name: 'isActive', label: t('common.active'), type: 'checkbox' },
    { name: 'notes', label: t('common.notes'), type: 'textarea', wide: true },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t('sales.priceLists')} action={{ label: t('sales.newPriceList'), onClick: () => form.open() }} />
      <DataTable
        data={lists}
        loading={isLoading}
        searchable
        onRowClick={(r: Row) => rules.open(r)}
        columns={[
          { key: 'name', header: t('common.name') },
          { key: 'validFrom', header: t('sales.validFrom'), render: (r: Row) => fmtDate(r.validFrom) },
          { key: 'validTo', header: t('sales.validTo'), render: (r: Row) => fmtDate(r.validTo) },
          { key: 'rules', header: t('sales.rules'), render: (r: Row) => r.rules?.length ?? 0 },
          { key: 'isActive', header: t('common.status'), render: (r: Row) => <Status status={r.isActive ? 'active' : 'inactive'} /> },
        ]}
        actions={(r: Row) => (
          <RowActions>
            <RowAction onClick={() => rules.open(r)}>{t('sales.rules')}</RowAction>
            <RowAction tone="gray" onClick={() => form.open(r)}>{t('common.edit')}</RowAction>
          </RowActions>
        )}
      />
      <PriceChecker />
      <Modal isOpen={form.isOpen} onClose={form.close} title={form.data ? t('sales.editPriceList') : t('sales.newPriceList')}>
        <EntityForm
          key={form.data?.id ?? 'new'}
          fields={fields}
          mode={form.data ? 'edit' : 'create'}
          initial={form.data ?? { isActive: true }}
          loading={save.isPending}
          onSubmit={(p) => save.mutate(p)}
          onCancel={form.close}
        />
      </Modal>
      {rules.data && <RulesModal listId={rules.data.id} onClose={rules.close} />}
    </div>
  );
}

const RULE_TYPES = ['fixed', 'discount', 'markup'];

function RulesModal({ listId, onClose }: { listId: string; onClose: () => void }) {
  const t = useTranslations('ops');
  const name = useNamer();
  const { data: list } = useOpsQuery(['price-list', listId], () => opsSales.priceList(listId));
  const { data: products = [] } = useOpsProducts();
  const { data: categories = [] } = useOpsCategories();
  const productMap = byId(products);
  const catMap = byId(categories);
  const empty = { target: 'product', productId: '', categoryId: '', ruleType: 'fixed', value: '', minQuantity: '', validFrom: '', validTo: '' };
  const [draft, setDraft] = useState(empty);
  const inv = ['price-list', 'price-lists'];
  const add = useOpsMutation(
    () =>
      opsSales.addPriceRule(listId, {
        productId: draft.target === 'product' ? draft.productId || undefined : undefined,
        categoryId: draft.target === 'category' ? draft.categoryId || undefined : undefined,
        ruleType: draft.ruleType,
        value: Number(draft.value),
        minQuantity: draft.minQuantity === '' ? undefined : Number(draft.minQuantity),
        validFrom: draft.validFrom || undefined,
        validTo: draft.validTo || undefined,
      }),
    { invalidate: inv, onSuccess: () => setDraft(empty) },
  );
  const remove = useOpsMutation((ruleId: string) => opsSales.deletePriceRule(listId, ruleId), { invalidate: inv, success: 'deleted' });

  return (
    <Modal isOpen onClose={onClose} title={`${t('sales.rules')} - ${list?.name ?? ''}`} size="xl">
      <p className="text-sm text-gray-600 mb-3">{t('sales.rulesHint')}</p>
      <SimpleTable
        rows={list?.rules ?? []}
        columns={[
          {
            key: 'target',
            header: t('sales.appliesTo'),
            render: (r) =>
              r.productId ? `${t('common.product')}: ${name(productMap[r.productId])}` : r.categoryId ? `${t('sales.category')}: ${name(catMap[r.categoryId])}` : t('sales.allProducts'),
          },
          { key: 'ruleType', header: t('sales.ruleType'), render: (r) => t(`sales.ruleTypes.${r.ruleType}`) },
          { key: 'value', header: t('sales.value'), render: (r) => (r.ruleType === 'fixed' ? fmtMoney(r.value) : `${fmtQty(r.value)}%`) },
          { key: 'minQuantity', header: t('sales.minQuantity'), render: (r) => fmtQty(r.minQuantity) },
          { key: 'validFrom', header: t('sales.validFrom'), render: (r) => fmtDate(r.validFrom) },
          { key: 'validTo', header: t('sales.validTo'), render: (r) => fmtDate(r.validTo) },
          { key: 'x', header: '', render: (r) => <RowAction tone="red" onClick={() => remove.mutate(r.id)}>{t('common.delete')}</RowAction> },
        ]}
      />
      <form
        className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end mt-4"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate(undefined);
        }}
      >
        <Field label={t('sales.appliesTo')}>
          <SelectBox
            value={draft.target}
            onChange={(v) => setDraft({ ...draft, target: v })}
            emptyLabel={false}
            options={[
              { value: 'product', label: t('common.product') },
              { value: 'category', label: t('sales.category') },
              { value: 'all', label: t('sales.allProducts') },
            ]}
          />
        </Field>
        {draft.target === 'product' && (
          <Field label={t('common.product')} required>
            <SelectBox value={draft.productId} onChange={(v) => setDraft({ ...draft, productId: v })} required options={toOptions(products, name)} />
          </Field>
        )}
        {draft.target === 'category' && (
          <Field label={t('sales.category')} required>
            <SelectBox value={draft.categoryId} onChange={(v) => setDraft({ ...draft, categoryId: v })} required options={toOptions(categories, name, false)} />
          </Field>
        )}
        <Field label={t('sales.ruleType')}>
          <SelectBox value={draft.ruleType} onChange={(v) => setDraft({ ...draft, ruleType: v })} emptyLabel={false} options={RULE_TYPES.map((r) => ({ value: r, label: t(`sales.ruleTypes.${r}`) }))} />
        </Field>
        <Field label={draft.ruleType === 'fixed' ? t('common.price') : t('sales.percent')} required>
          <input type="number" step="any" min="0" required value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} className={inputCls} />
        </Field>
        <Field label={t('sales.minQuantity')}>
          <input type="number" step="any" min="0" value={draft.minQuantity} onChange={(e) => setDraft({ ...draft, minQuantity: e.target.value })} className={inputCls} />
        </Field>
        <Field label={t('sales.validFrom')}>
          <input type="date" value={draft.validFrom} onChange={(e) => setDraft({ ...draft, validFrom: e.target.value })} className={inputCls} />
        </Field>
        <Field label={t('sales.validTo')}>
          <input type="date" value={draft.validTo} onChange={(e) => setDraft({ ...draft, validTo: e.target.value })} className={inputCls} />
        </Field>
        <Btn type="submit" loading={add.isPending}>{t('sales.addRule')}</Btn>
      </form>
    </Modal>
  );
}

/** Asks the pricing engine for the price of a product for a customer / quantity / date. */
function PriceChecker() {
  const t = useTranslations('ops');
  const name = useNamer();
  const { data: products = [] } = useOpsProducts();
  const { data: customers = [] } = useOpsCustomers();
  const { data: lists = [] } = useOpsPriceLists();
  const [q, setQ] = useState({ productId: '', customerId: '', priceListId: '', quantity: '1', date: today() });
  const [result, setResult] = useState<any>(null);
  const check = useOpsMutation(
    () =>
      opsSales.price({
        productId: q.productId,
        customerId: q.customerId || undefined,
        priceListId: q.priceListId || undefined,
        quantity: Number(q.quantity) || 1,
        date: q.date || undefined,
      }),
    { success: false, onSuccess: (r) => setResult(r) },
  );
  return (
    <Card title={t('sales.priceChecker')}>
      <form
        className="grid grid-cols-2 md:grid-cols-6 gap-3 items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.productId) check.mutate(undefined);
        }}
      >
        <Field label={t('common.product')} required className="md:col-span-2">
          <SelectBox value={q.productId} onChange={(v) => setQ({ ...q, productId: v })} required options={toOptions(products, name)} />
        </Field>
        <Field label={t('common.customer')}>
          <SelectBox value={q.customerId} onChange={(v) => setQ({ ...q, customerId: v })} options={toOptions(customers, name)} />
        </Field>
        <Field label={t('sales.priceList')}>
          <SelectBox value={q.priceListId} onChange={(v) => setQ({ ...q, priceListId: v })} emptyLabel={t('common.auto')} options={lists.map((l) => ({ value: l.id, label: l.name }))} />
        </Field>
        <Field label={t('common.quantity')}>
          <input type="number" step="any" min="0" value={q.quantity} onChange={(e) => setQ({ ...q, quantity: e.target.value })} className={inputCls} />
        </Field>
        <Field label={t('common.date')}>
          <input type="date" value={q.date} onChange={(e) => setQ({ ...q, date: e.target.value })} className={inputCls} />
        </Field>
        <Btn type="submit" loading={check.isPending}>{t('sales.checkPrice')}</Btn>
      </form>
      {result && (
        <div className="mt-4">
          <DetailGrid
            items={[
              { label: t('common.unitPrice'), value: <span className="text-lg text-primary-700">{fmtMoney(result.unitPrice)}</span> },
              { label: t('sales.basePrice'), value: fmtMoney(result.basePrice) },
              { label: t('sales.priceList'), value: lists.find((l) => l.id === result.priceListId)?.name ?? '-' },
              { label: t('sales.ruleType'), value: result.ruleType ? t(`sales.ruleTypes.${result.ruleType}`) : '-' },
              { label: t('inv.minSellPrice'), value: result.minSellPrice != null ? fmtMoney(result.minSellPrice) : '-' },
            ]}
          />
        </div>
      )}
    </Card>
  );
}
