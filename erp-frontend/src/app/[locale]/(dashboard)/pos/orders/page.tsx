'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import { Btn, Field, inputCls, SelectBox } from '@/components/operations/form';
import { byId, FilterBar, fmtDateTime, fmtMoney, num, RowAction, RowActions, SimpleTable, Status, useNamer } from '@/components/operations/common';
import Pager from '@/components/operations/Pager';
import RefundModal from '@/components/operations/pos/RefundModal';
import { PrintButton } from '@/components/platform/PrintButton';
import { useOpsCustomers, useOpsMutation, useOpsProducts, useOpsQuery } from '@/hooks/use-operations';
import { opsPos } from '@/services/operations-pos.service';
import { opsCompliance } from '@/services/operations-compliance.service';
import { useRouter } from '@/i18n/navigation';
import type { Row } from '@/services/operations-api';

const LIMIT = 50;

/** POS orders across sessions: search, refunds, e-receipts and receipts. */
export default function PosOrdersPage() {
  const t = useTranslations('ops');
  const name = useNamer();
  const router = useRouter();
  const { data: customers = [] } = useOpsCustomers();
  const { data: products = [] } = useOpsProducts();
  const customerMap = byId(customers);
  const productMap = byId(products);
  const [draft, setDraft] = useState({ search: '', from: '', to: '', kind: '' as '' | 'sales' | 'refunds', customerId: '' });
  const [filters, setFilters] = useState(draft);
  const [offset, setOffset] = useState(0);
  const { data: orders = [], isLoading } = useOpsQuery(['pos-orders', 'search', filters, offset], () =>
    opsPos.orders({
      search: filters.search || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
      customerId: filters.customerId || undefined,
      refunds: filters.kind === '' ? undefined : filters.kind === 'refunds',
      limit: LIMIT,
      offset,
    }),
  );
  const [refunding, setRefunding] = useState<Row | null>(null);
  const eReceipt = useOpsMutation((id: string) => opsCompliance.submitReceipt(id), { invalidate: ['e-receipts'], success: 'submitted' });

  const apply = () => {
    setOffset(0);
    setFilters(draft);
  };

  return (
    <div>
      <PageHeader title={t('pos.ordersSearch')} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <FilterBar>
          <Field label={t('common.search')}>
            <input
              className={inputCls}
              placeholder={t('pos.searchOrdersHint')}
              value={draft.search}
              onChange={(e) => setDraft({ ...draft, search: e.target.value })}
            />
          </Field>
          <Field label={t('common.from')}>
            <input type="date" className={inputCls} value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          </Field>
          <Field label={t('common.to')}>
            <input type="date" className={inputCls} value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          </Field>
          <Field label={t('common.type')}>
            <SelectBox
              value={draft.kind}
              onChange={(v) => setDraft({ ...draft, kind: v as any })}
              options={[
                { value: 'sales', label: t('pos.salesOnly') },
                { value: 'refunds', label: t('pos.refundsOnly') },
              ]}
              emptyLabel={t('common.all')}
            />
          </Field>
          <Field label={t('common.customer')}>
            <SelectBox
              value={draft.customerId}
              onChange={(v) => setDraft({ ...draft, customerId: v })}
              options={customers.map((c) => ({ value: c.id, label: name(c) }))}
              emptyLabel={t('common.all')}
            />
          </Field>
          <Btn type="submit">{t('common.show')}</Btn>
        </FilterBar>
      </form>
      <div className="bg-white rounded-xl border border-gray-200 p-3">
        {isLoading ? (
          <p className="text-sm text-gray-500 p-4">{t('common.loading')}</p>
        ) : (
          <SimpleTable
            rows={orders}
            columns={[
              { key: 'orderNumber', header: t('common.number') },
              { key: 'createdAt', header: t('common.date'), render: (o) => fmtDateTime(o.createdAt) },
              { key: 'customerId', header: t('common.customer'), render: (o) => (o.customerId ? name(customerMap[o.customerId]) : t('pos.walkInCustomer')) },
              { key: 'paymentMethod', header: t('pos.method'), render: (o) => t(`pos.methods.${o.paymentMethod}`) },
              {
                key: 'totalAmount',
                header: t('common.total'),
                render: (o) => <span className={num(o.totalAmount) < 0 ? 'text-red-600' : ''}>{fmtMoney(o.totalAmount)}</span>,
              },
              { key: 'kind', header: t('common.type'), render: (o) => (o.refundedOrderId ? t('pos.refundDoc') : t('pos.saleDoc')) },
              { key: 'status', header: t('common.status'), render: (o) => <Status status={o.status} /> },
              {
                key: 'x',
                header: '',
                render: (o) => (
                  <RowActions>
                    <RowAction onClick={() => router.push(`/pos/orders/${o.id}`)}>{t('common.view')}</RowAction>
                    {o.status === 'completed' && !o.refundedOrderId && num(o.totalAmount) > 0 && (
                      <RowAction tone="amber" onClick={() => setRefunding(o)}>
                        {t('pos.refund')}
                      </RowAction>
                    )}
                    <RowAction tone="gray" disabled={eReceipt.isPending && eReceipt.variables === o.id} onClick={() => eReceipt.mutate(o.id)}>
                      {t('pos.eReceipt')}
                    </RowAction>
                    <PrintButton path={`/print/pos-orders/${o.id}`} params={{ paper: '80mm' }} label={t('pos.receipt')} />
                  </RowActions>
                ),
              },
            ]}
          />
        )}
        <Pager offset={offset} limit={LIMIT} count={orders.length} onChange={setOffset} />
      </div>
      {refunding && (
        <RefundModal
          order={refunding}
          productName={(id) => (productMap[id] ? name(productMap[id]) : id)}
          onClose={() => setRefunding(null)}
        />
      )}
    </div>
  );
}
