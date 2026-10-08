'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { Btn, EntityForm, Field, inputCls, SelectBox, toOptions, type FieldDef } from '@/components/operations/form';
import {
  byId, Card, fmtDate, fmtMoney, num, RowAction, RowActions, SimpleTable, Stat, Status, Tabs, today, useModal, useNamer,
} from '@/components/operations/common';
import { useOpsCategories, useOpsMutation, useOpsQuery, useOpsReps } from '@/hooks/use-operations';
import { opsSales } from '@/services/operations-sales.service';
import type { Row } from '@/services/operations-api';

type Tab = 'reps' | 'rules' | 'statements';

/** Sales representatives, commission rules and commission statements. */
export default function SalesRepsPage() {
  const t = useTranslations('ops');
  const [tab, setTab] = useState<Tab>('reps');
  return (
    <div>
      <PageHeader title={t('sales.repsTitle')} />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'reps', label: t('sales.reps') },
          { key: 'rules', label: t('sales.commissionRules') },
          { key: 'statements', label: t('sales.commissionStatements') },
        ]}
      />
      {tab === 'reps' && <RepsTab />}
      {tab === 'rules' && <RulesTab />}
      {tab === 'statements' && <StatementsTab />}
    </div>
  );
}

function RepsTab() {
  const t = useTranslations('ops');
  const { data: reps = [], isLoading } = useOpsReps();
  const form = useModal<Row>();
  const save = useOpsMutation((body: any) => (form.data ? opsSales.updateRep(form.data.id, body) : opsSales.createRep(body)), {
    invalidate: ['reps'],
    onSuccess: () => form.close(),
  });
  const fields: FieldDef[] = [
    { name: 'code', label: t('common.code'), required: true },
    { name: 'name', label: t('common.name'), required: true },
    { name: 'phone', label: t('common.phone') },
    { name: 'email', label: t('common.email'), type: 'email' },
    { name: 'isActive', label: t('common.active'), type: 'checkbox' },
  ];
  return (
    <>
      <div className="flex justify-end mb-3">
        <Btn onClick={() => form.open()}>{t('sales.newRep')}</Btn>
      </div>
      <DataTable
        data={reps}
        loading={isLoading}
        searchable
        columns={[
          { key: 'code', header: t('common.code') },
          { key: 'name', header: t('common.name') },
          { key: 'phone', header: t('common.phone') },
          { key: 'email', header: t('common.email') },
          { key: 'isActive', header: t('common.status'), render: (r: Row) => <Status status={r.isActive ? 'active' : 'inactive'} /> },
        ]}
        actions={(r: Row) => <RowAction onClick={() => form.open(r)}>{t('common.edit')}</RowAction>}
      />
      <Modal isOpen={form.isOpen} onClose={form.close} title={form.data ? t('sales.editRep') : t('sales.newRep')}>
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
    </>
  );
}

function RulesTab() {
  const t = useTranslations('ops');
  const name = useNamer();
  const { data: reps = [] } = useOpsReps();
  const { data: categories = [] } = useOpsCategories();
  const repMap = byId(reps);
  const catMap = byId(categories);
  const { data: rules = [], isLoading } = useOpsQuery(['commission-rules'], () => opsSales.commissionRules());
  const form = useModal<Row>();
  const save = useOpsMutation(
    (body: any) => (form.data ? opsSales.updateCommissionRule(form.data.id, body) : opsSales.createCommissionRule(body)),
    { invalidate: ['commission-rules'], onSuccess: () => form.close() },
  );
  const fields: FieldDef[] = [
    { name: 'name', label: t('common.name'), required: true, wide: true },
    { name: 'salesRepId', label: t('sales.salesRep'), type: 'select', emptyLabel: t('sales.allReps'), options: reps.map((r) => ({ value: r.id, label: `${r.code} - ${r.name}` })) },
    { name: 'productCategoryId', label: t('sales.category'), type: 'select', emptyLabel: t('sales.allProducts'), options: toOptions(categories, name, false) },
    {
      name: 'basis',
      label: t('sales.basis'),
      type: 'select',
      required: true,
      options: [
        { value: 'invoiced', label: t('sales.basisTypes.invoiced') },
        { value: 'collected', label: t('sales.basisTypes.collected') },
      ],
    },
    { name: 'rate', label: t('sales.ratePercent'), type: 'number', min: 0, max: 100, required: true },
    { name: 'targetAmount', label: t('sales.targetAmount'), type: 'number', min: 0, hint: t('sales.targetAmountHint') },
    { name: 'isActive', label: t('common.active'), type: 'checkbox' },
  ];
  return (
    <>
      <div className="flex justify-end mb-3">
        <Btn onClick={() => form.open()}>{t('sales.newCommissionRule')}</Btn>
      </div>
      <DataTable
        data={rules}
        loading={isLoading}
        columns={[
          { key: 'name', header: t('common.name') },
          { key: 'salesRepId', header: t('sales.salesRep'), render: (r: Row) => repMap[r.salesRepId]?.name ?? t('sales.allReps') },
          { key: 'productCategoryId', header: t('sales.category'), render: (r: Row) => (r.productCategoryId ? name(catMap[r.productCategoryId]) : t('sales.allProducts')) },
          { key: 'basis', header: t('sales.basis'), render: (r: Row) => t(`sales.basisTypes.${r.basis}`) },
          { key: 'rate', header: t('sales.ratePercent'), render: (r: Row) => `${num(r.rate)}%` },
          { key: 'targetAmount', header: t('sales.targetAmount'), render: (r: Row) => fmtMoney(r.targetAmount) },
          { key: 'isActive', header: t('common.status'), render: (r: Row) => <Status status={r.isActive ? 'active' : 'inactive'} /> },
        ]}
        actions={(r: Row) => <RowAction onClick={() => form.open(r)}>{t('common.edit')}</RowAction>}
      />
      <Modal isOpen={form.isOpen} onClose={form.close} title={form.data ? t('sales.editCommissionRule') : t('sales.newCommissionRule')}>
        <EntityForm
          key={form.data?.id ?? 'new'}
          fields={fields}
          mode={form.data ? 'edit' : 'create'}
          initial={form.data ?? { isActive: true, basis: 'invoiced' }}
          loading={save.isPending}
          onSubmit={(p) => save.mutate(p)}
          onCancel={form.close}
        />
      </Modal>
    </>
  );
}

function StatementsTab() {
  const t = useTranslations('ops');
  const { data: reps = [] } = useOpsReps();
  const repMap = byId(reps);
  const first = today().slice(0, 8) + '01';
  const [q, setQ] = useState({ salesRepId: '', periodFrom: first, periodTo: today() });
  const [preview, setPreview] = useState<any>(null);
  const { data: statements = [], isLoading } = useOpsQuery(['commission-statements'], () => opsSales.commissionStatements());
  const detail = useModal<Row>();
  const inv = ['commission-statements'];
  const doPreview = useOpsMutation(() => opsSales.commissionPreview(q), { success: false, onSuccess: (r) => setPreview(r) });
  const create = useOpsMutation(() => opsSales.createCommissionStatement(q), { invalidate: inv, onSuccess: () => setPreview(null) });
  const post = useOpsMutation((id: string) => opsSales.postCommissionStatement(id, {}), { invalidate: inv, success: 'posted' });
  const cancel = useOpsMutation((id: string) => opsSales.cancelCommissionStatement(id), { invalidate: inv, success: 'cancelled' });

  const lineCols = [
    { key: 'invoiceNumber', header: t('sales.invoice') },
    { key: 'basis', header: t('sales.basis'), render: (l: any) => (t.has(`sales.basisTypes.${l.basis}`) ? t(`sales.basisTypes.${l.basis}`) : l.basis) },
    { key: 'baseAmount', header: t('sales.baseAmount'), render: (l: any) => fmtMoney(l.baseAmount) },
    { key: 'rate', header: t('sales.ratePercent'), render: (l: any) => `${num(l.rate)}%` },
    { key: 'commission', header: t('sales.commission'), render: (l: any) => fmtMoney(l.commission ?? l.commissionAmount) },
  ];

  return (
    <div className="space-y-4">
      <Card title={t('sales.computeCommission')}>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (q.salesRepId) doPreview.mutate(undefined);
          }}
        >
          <Field label={t('sales.salesRep')} required>
            <SelectBox value={q.salesRepId} onChange={(v) => setQ({ ...q, salesRepId: v })} required options={reps.map((r) => ({ value: r.id, label: `${r.code} - ${r.name}` }))} />
          </Field>
          <Field label={t('common.from')}>
            <input type="date" required value={q.periodFrom} onChange={(e) => setQ({ ...q, periodFrom: e.target.value })} className={inputCls} />
          </Field>
          <Field label={t('common.to')}>
            <input type="date" required value={q.periodTo} onChange={(e) => setQ({ ...q, periodTo: e.target.value })} className={inputCls} />
          </Field>
          <Btn type="submit" variant="secondary" loading={doPreview.isPending}>{t('sales.preview')}</Btn>
          <Btn disabled={!q.salesRepId} loading={create.isPending} onClick={() => create.mutate(undefined)}>{t('sales.createStatement')}</Btn>
        </form>
        {preview && (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <Stat label={t('sales.invoicedAmount')} value={fmtMoney(preview.invoicedAmount)} />
              <Stat label={t('sales.collectedAmount')} value={fmtMoney(preview.collectedAmount)} />
              <Stat label={t('sales.commission')} value={fmtMoney(preview.commissionAmount)} tone="green" />
            </div>
            <SimpleTable rows={preview.lines ?? []} columns={lineCols} />
          </div>
        )}
      </Card>
      <DataTable
        data={statements}
        loading={isLoading}
        onRowClick={(s: Row) => detail.open(s)}
        columns={[
          { key: 'statementNumber', header: t('common.number') },
          { key: 'salesRepId', header: t('sales.salesRep'), render: (s: Row) => repMap[s.salesRepId]?.name ?? '-' },
          { key: 'periodFrom', header: t('common.from'), render: (s: Row) => fmtDate(s.periodFrom) },
          { key: 'periodTo', header: t('common.to'), render: (s: Row) => fmtDate(s.periodTo) },
          { key: 'commissionAmount', header: t('sales.commission'), render: (s: Row) => fmtMoney(s.commissionAmount) },
          { key: 'status', header: t('common.status'), render: (s: Row) => <Status status={s.status} /> },
        ]}
        actions={(s: Row) => (
          <RowActions>
            {s.status === 'draft' && <RowAction tone="green" onClick={() => post.mutate(s.id)}>{t('sales.post')}</RowAction>}
            {s.status !== 'cancelled' && <RowAction tone="red" onClick={() => cancel.mutate(s.id)}>{t('common.cancel')}</RowAction>}
          </RowActions>
        )}
      />
      {detail.data && (
        <Modal isOpen onClose={detail.close} title={`${t('sales.commissionStatement')} ${detail.data.statementNumber ?? ''}`} size="xl">
          <SimpleTable rows={detail.data.lines ?? []} columns={lineCols} />
        </Modal>
      )}
    </div>
  );
}
