'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { Field, inputCls, SelectBox } from '@/components/operations/form';
import { byId, FilterBar, fmtDateTime, fmtMoney, num, SimpleTable, Status, Tabs } from '@/components/operations/common';
import { SessionReport } from '@/components/operations/pos/PosModals';
import { useOpsQuery, useOpsTerminals } from '@/hooks/use-operations';
import { opsPos } from '@/services/operations-pos.service';
import { Link } from '@/i18n/navigation';
import type { Row } from '@/services/operations-api';

/** History of POS sessions with the X / Z session report. */
export default function PosSessionsPage() {
  const t = useTranslations('ops');
  const { data: terminals = [] } = useOpsTerminals();
  const terminalMap = byId(terminals);
  const [filters, setFilters] = useState({ terminalId: '', status: '' as '' | 'open' | 'closed', from: '', to: '', mine: false });
  const { data: sessions = [], isLoading } = useOpsQuery(['pos-sessions', filters], () => opsPos.sessions(filters));
  const [selected, setSelected] = useState<Row | null>(null);

  return (
    <div>
      <PageHeader title={t('pos.sessionsHistory')} />
      <FilterBar>
        <Field label={t('pos.terminal')}>
          <SelectBox
            value={filters.terminalId}
            onChange={(v) => setFilters({ ...filters, terminalId: v })}
            options={terminals.map((x) => ({ value: x.id, label: x.name }))}
            emptyLabel={t('common.all')}
          />
        </Field>
        <Field label={t('common.status')}>
          <SelectBox
            value={filters.status}
            onChange={(v) => setFilters({ ...filters, status: v as any })}
            options={[
              { value: 'open', label: t('status.open') },
              { value: 'closed', label: t('status.closed') },
            ]}
            emptyLabel={t('common.all')}
          />
        </Field>
        <Field label={t('common.from')}>
          <input type="date" className={inputCls} value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        </Field>
        <Field label={t('common.to')}>
          <input type="date" className={inputCls} value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        </Field>
        <label className="flex items-center gap-2 text-sm pb-2">
          <input type="checkbox" checked={filters.mine} onChange={(e) => setFilters({ ...filters, mine: e.target.checked })} />
          {t('pos.mySessions')}
        </label>
      </FilterBar>
      <DataTable
        data={sessions}
        loading={isLoading}
        pageSize={25}
        onRowClick={setSelected}
        columns={[
          { key: 'terminalId', header: t('pos.terminal'), render: (s: Row) => terminalMap[s.terminalId]?.name ?? '-' },
          { key: 'openedAt', header: t('pos.openedAt'), render: (s: Row) => fmtDateTime(s.openedAt) },
          { key: 'closedAt', header: t('pos.closedAt'), render: (s: Row) => (s.closedAt ? fmtDateTime(s.closedAt) : '-') },
          { key: 'openingCash', header: t('pos.openingCash'), render: (s: Row) => fmtMoney(s.openingCash) },
          { key: 'expectedCash', header: t('pos.expectedCash'), render: (s: Row) => (s.expectedCash != null ? fmtMoney(s.expectedCash) : '-') },
          { key: 'closingCash', header: t('pos.countedCash'), render: (s: Row) => (s.closingCash != null ? fmtMoney(s.closingCash) : '-') },
          {
            key: 'cashDifference',
            header: t('pos.difference'),
            render: (s: Row) =>
              s.cashDifference != null ? (
                <span className={num(s.cashDifference) < 0 ? 'text-red-600' : num(s.cashDifference) > 0 ? 'text-green-700' : ''}>{fmtMoney(s.cashDifference)}</span>
              ) : (
                '-'
              ),
          },
          { key: 'status', header: t('common.status'), render: (s: Row) => <Status status={s.status} /> },
        ]}
      />
      {selected && <SessionDetail session={selected} terminalName={terminalMap[selected.terminalId]?.name ?? ''} onClose={() => setSelected(null)} />}
    </div>
  );
}

function SessionDetail({ session, terminalName, onClose }: { session: Row; terminalName: string; onClose: () => void }) {
  const t = useTranslations('ops');
  const [tab, setTab] = useState<'report' | 'orders' | 'cash'>('report');
  const summary = useOpsQuery(['pos-summary', session.id], () => opsPos.summary(session.id));
  const orders = useOpsQuery(['pos-orders', session.id], () => opsPos.sessionOrders(session.id), { enabled: tab === 'orders' });
  const cash = useOpsQuery(['pos-cash', session.id], () => opsPos.cashMovements(session.id), { enabled: tab === 'cash' });
  return (
    <Modal isOpen onClose={onClose} title={`${terminalName} - ${fmtDateTime(session.openedAt)}`} size="xl">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'report', label: session.status === 'closed' ? t('pos.zReport') : t('pos.xReport') },
          { key: 'orders', label: t('pos.sessionOrders') },
          { key: 'cash', label: t('pos.cashInOut') },
        ]}
      />
      {tab === 'report' &&
        (summary.isLoading ? <p className="text-sm text-gray-500">{t('common.loading')}</p> : <SessionReport summary={summary.data} session={session} />)}
      {tab === 'orders' && (
        <SimpleTable
          rows={orders.data ?? []}
          columns={[
            {
              key: 'orderNumber',
              header: t('common.number'),
              render: (o) => (
                <Link href={`/pos/orders/${o.id}`} className="text-primary-600 hover:underline">
                  {o.orderNumber}
                </Link>
              ),
            },
            { key: 'createdAt', header: t('common.date'), render: (o) => fmtDateTime(o.createdAt) },
            { key: 'paymentMethod', header: t('pos.method'), render: (o) => t(`pos.methods.${o.paymentMethod}`) },
            { key: 'totalAmount', header: t('common.total'), render: (o) => fmtMoney(o.totalAmount) },
            { key: 'status', header: t('common.status'), render: (o) => <Status status={o.status} /> },
          ]}
        />
      )}
      {tab === 'cash' && (
        <SimpleTable
          rows={cash.data ?? []}
          columns={[
            { key: 'createdAt', header: t('common.date'), render: (m) => fmtDateTime(m.createdAt) },
            { key: 'type', header: t('common.type'), render: (m) => (m.type === 'in' ? t('pos.cashIn') : t('pos.cashOut')) },
            { key: 'amount', header: t('common.amount'), render: (m) => fmtMoney(m.amount) },
            { key: 'reason', header: t('common.reason') },
          ]}
        />
      )}
    </Modal>
  );
}
