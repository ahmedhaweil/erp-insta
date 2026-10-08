'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { Btn, Field, inputCls, SelectBox, toOptions } from '@/components/operations/form';
import {
  byId, Card, DetailGrid, FilterBar, fmtDate, fmtMoney, num, RowAction, RowActions, SimpleTable, Stat, Status, Tabs, useModal, useNamer,
} from '@/components/operations/common';
import InstallmentPlanModal from '@/components/operations/sales/InstallmentPlanModal';
import { useOpsCustomers, useOpsMutation, useOpsQuery } from '@/hooks/use-operations';
import { opsSales } from '@/services/operations-sales.service';
import type { Row } from '@/services/operations-api';

type Tab = 'plans' | 'due' | 'statement';

/** Installment sales: plans, due / overdue installments and customer statements. */
export default function InstallmentsPage() {
  const t = useTranslations('ops');
  const [tab, setTab] = useState<Tab>('plans');
  return (
    <div>
      <PageHeader title={t('sales.installments')} />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'plans', label: t('sales.plans') },
          { key: 'due', label: t('sales.dueInstallments') },
          { key: 'statement', label: t('sales.customerStatement') },
        ]}
      />
      {tab === 'plans' && <PlansTab />}
      {tab === 'due' && <DueTab />}
      {tab === 'statement' && <StatementTab />}
    </div>
  );
}

function scheduleColumns(t: ReturnType<typeof useTranslations>) {
  return [
    { key: 'sequence', header: '#' },
    { key: 'dueDate', header: t('common.dueDate'), render: (i: any) => fmtDate(i.dueDate) },
    { key: 'amount', header: t('common.amount'), render: (i: any) => fmtMoney(i.amount) },
    { key: 'paidAmount', header: t('common.paid'), render: (i: any) => fmtMoney(i.paidAmount) },
    { key: 'remaining', header: t('common.residual'), render: (i: any) => fmtMoney(i.remaining ?? num(i.amount) - num(i.paidAmount)) },
    { key: 'status', header: t('common.status'), render: (i: any) => <Status status={i.status} /> },
  ];
}

function PlansTab() {
  const t = useTranslations('ops');
  const name = useNamer();
  const [status, setStatus] = useState('');
  const [customerId, setCustomerId] = useState('');
  const { data: customers = [] } = useOpsCustomers();
  const customerMap = byId(customers);
  const { data: plans = [], isLoading } = useOpsQuery(['installment-plans', status, customerId], () => opsSales.installmentPlans({ status, customerId }));
  const { data: invoices = [] } = useOpsQuery(['sales-invoices'], opsSales.invoices);
  const create = useModal();
  const detail = useModal<Row>();
  const inv = ['installment-plans', 'installments-due', 'installment-plan'];
  const recompute = useOpsMutation((id: string) => opsSales.recomputePlan(id), { invalidate: inv, success: 'recomputed' });
  const cancel = useOpsMutation((id: string) => opsSales.cancelPlan(id), { invalidate: inv, success: 'cancelled' });
  const plan = useOpsQuery(['installment-plan', detail.data?.id], () => opsSales.installmentPlan(detail.data!.id), { enabled: !!detail.data });
  const eligible = invoices.filter((i) => i.moveType !== 'credit_note' && ['posted', 'sent', 'partial', 'overdue'].includes(i.status));

  return (
    <>
      <FilterBar>
        <Field label={t('common.status')}>
          <SelectBox value={status} onChange={setStatus} emptyLabel={t('common.all')} options={['active', 'completed', 'cancelled'].map((s) => ({ value: s, label: t(`status.${s}`) }))} />
        </Field>
        <Field label={t('common.customer')}>
          <SelectBox value={customerId} onChange={setCustomerId} emptyLabel={t('common.all')} options={toOptions(customers, name)} />
        </Field>
        <Btn onClick={() => create.open()}>{t('sales.newPlan')}</Btn>
      </FilterBar>
      <DataTable
        data={plans}
        loading={isLoading}
        searchable
        onRowClick={(p: Row) => detail.open(p)}
        columns={[
          { key: 'planNumber', header: t('common.number') },
          { key: 'customerId', header: t('common.customer'), render: (p: Row) => name(p.customer ?? customerMap[p.customerId]) },
          { key: 'invoiceId', header: t('sales.invoice'), render: (p: Row) => p.invoice?.invoiceNumber ?? invoices.find((i) => i.id === p.invoiceId)?.invoiceNumber ?? '-' },
          { key: 'numberOfInstallments', header: t('sales.numberOfInstallments') },
          { key: 'frequency', header: t('sales.frequency'), render: (p: Row) => t(`sales.frequencies.${p.frequency}`) },
          { key: 'totalAmount', header: t('common.total'), render: (p: Row) => fmtMoney(p.totalAmount) },
          { key: 'paidAmount', header: t('common.paid'), render: (p: Row) => fmtMoney(p.paidAmount) },
          { key: 'status', header: t('common.status'), render: (p: Row) => <Status status={p.status} /> },
        ]}
        actions={(p: Row) => (
          <RowActions>
            {p.status === 'active' && (
              <>
                <RowAction onClick={() => recompute.mutate(p.id)}>{t('sales.recompute')}</RowAction>
                <RowAction tone="red" onClick={() => cancel.mutate(p.id)}>{t('common.cancel')}</RowAction>
              </>
            )}
          </RowActions>
        )}
      />
      {create.isOpen && <InstallmentPlanModal invoices={eligible} onClose={create.close} />}
      {detail.data && (
        <Modal isOpen onClose={detail.close} title={`${t('sales.plan')} ${detail.data.planNumber}`} size="xl">
          {plan.data ? (
            <div className="space-y-4">
              <DetailGrid
                items={[
                  { label: t('common.customer'), value: name(plan.data.customer) },
                  { label: t('sales.invoice'), value: plan.data.invoice?.invoiceNumber },
                  { label: t('sales.principal'), value: fmtMoney(plan.data.principalAmount) },
                  { label: t('sales.downPayment'), value: fmtMoney(plan.data.downPayment) },
                  { label: t('sales.interestRate'), value: `${num(plan.data.interestRate)}%` },
                  { label: t('sales.interestAmount'), value: fmtMoney(plan.data.interestAmount) },
                  { label: t('common.total'), value: fmtMoney(plan.data.totalAmount) },
                  { label: t('common.paid'), value: fmtMoney(plan.data.paidAmount) },
                ]}
              />
              <SimpleTable rows={plan.data.installments ?? []} columns={scheduleColumns(t)} />
            </div>
          ) : (
            <p className="text-sm text-gray-500">{t('common.loading')}</p>
          )}
        </Modal>
      )}
    </>
  );
}

function DueTab() {
  const t = useTranslations('ops');
  const name = useNamer();
  const { data: customers = [] } = useOpsCustomers();
  const [f, setF] = useState({ asOf: '', dueTo: '', status: '', customerId: '' });
  const { data, isLoading } = useOpsQuery(['installments-due', f], () => opsSales.dueInstallments(f));
  const rows = (data?.rows ?? []).map((r: any) => ({ id: r.installmentId, ...r }));
  return (
    <>
      <FilterBar>
        <Field label={t('sales.asOf')}>
          <input type="date" value={f.asOf} onChange={(e) => setF({ ...f, asOf: e.target.value })} className={inputCls} />
        </Field>
        <Field label={t('sales.dueUntil')}>
          <input type="date" value={f.dueTo} onChange={(e) => setF({ ...f, dueTo: e.target.value })} className={inputCls} />
        </Field>
        <Field label={t('common.status')}>
          <SelectBox value={f.status} onChange={(v) => setF({ ...f, status: v })} emptyLabel={t('common.all')} options={['due', 'partial', 'overdue', 'paid'].map((s) => ({ value: s, label: t(`status.${s}`) }))} />
        </Field>
        <Field label={t('common.customer')}>
          <SelectBox value={f.customerId} onChange={(v) => setF({ ...f, customerId: v })} emptyLabel={t('common.all')} options={toOptions(customers, name)} />
        </Field>
      </FilterBar>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Stat label={t('sales.totalRemaining')} value={fmtMoney(data?.totalRemaining)} />
        <Stat label={t('sales.totalOverdue')} value={fmtMoney(data?.totalOverdue)} tone="red" />
      </div>
      <DataTable
        data={rows}
        loading={isLoading}
        searchable
        pageSize={25}
        columns={[
          { key: 'planNumber', header: t('sales.plan') },
          { key: 'invoiceNumber', header: t('sales.invoice') },
          { key: 'customerName', header: t('common.customer') },
          { key: 'sequence', header: '#' },
          { key: 'dueDate', header: t('common.dueDate'), render: (r: any) => fmtDate(r.dueDate) },
          { key: 'amount', header: t('common.amount'), render: (r: any) => fmtMoney(r.amount) },
          { key: 'remaining', header: t('common.residual'), render: (r: any) => fmtMoney(r.remaining) },
          { key: 'daysOverdue', header: t('sales.daysOverdue'), render: (r: any) => (r.daysOverdue ? <span className="text-red-600">{r.daysOverdue}</span> : '-') },
          { key: 'status', header: t('common.status'), render: (r: any) => <Status status={r.status} /> },
        ]}
      />
    </>
  );
}

function StatementTab() {
  const t = useTranslations('ops');
  const name = useNamer();
  const { data: customers = [] } = useOpsCustomers();
  const [customerId, setCustomerId] = useState('');
  const [asOf, setAsOf] = useState('');
  const { data, isLoading } = useOpsQuery(['installment-statement', customerId, asOf], () => opsSales.installmentStatement(customerId, asOf || undefined), {
    enabled: !!customerId,
  });
  return (
    <>
      <FilterBar>
        <Field label={t('common.customer')} required>
          <SelectBox value={customerId} onChange={setCustomerId} options={toOptions(customers, name)} />
        </Field>
        <Field label={t('sales.asOf')}>
          <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className={inputCls} />
        </Field>
        {data && <Btn variant="secondary" onClick={() => window.print()}>{t('common.print')}</Btn>}
      </FilterBar>
      {isLoading && customerId && <p className="text-sm text-gray-500">{t('common.loading')}</p>}
      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label={t('common.total')} value={fmtMoney(data.totalAmount)} />
            <Stat label={t('common.paid')} value={fmtMoney(data.paidAmount)} tone="green" />
            <Stat label={t('common.residual')} value={fmtMoney(data.remaining)} />
            <Stat label={t('sales.totalOverdue')} value={fmtMoney(data.overdueAmount)} tone="red" />
          </div>
          {(data.plans ?? []).length === 0 && <Card><p className="text-sm text-gray-500">{t('common.noData')}</p></Card>}
          {(data.plans ?? []).map((p: any) => (
            <Card
              key={p.planId}
              title={`${p.planNumber} - ${p.invoiceNumber}`}
              actions={<Status status={p.status} />}
            >
              <SimpleTable rows={p.installments ?? []} columns={scheduleColumns(t)} />
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
