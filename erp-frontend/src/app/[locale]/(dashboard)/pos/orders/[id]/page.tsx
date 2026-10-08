'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Btn } from '@/components/operations/form';
import { byId, Card, DetailGrid, fmtDateTime, fmtMoney, fmtQty, num, SimpleTable, Status, useNamer } from '@/components/operations/common';
import RefundModal from '@/components/operations/pos/RefundModal';
import { PrintMenu } from '@/components/platform/PrintButton';
import { useOpsCustomers, useOpsMutation, useOpsProducts, useOpsQuery, useOpsTerminals } from '@/hooks/use-operations';
import { opsPos } from '@/services/operations-pos.service';
import { opsCompliance } from '@/services/operations-compliance.service';
import { Link } from '@/i18n/navigation';

/** One POS order: lines, payment, refunds made from it, receipt printing and e-receipt. */
export default function PosOrderPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations('ops');
  const tp = useTranslations('platform');
  const name = useNamer();
  const { data: products = [] } = useOpsProducts();
  const { data: customers = [] } = useOpsCustomers();
  const { data: terminals = [] } = useOpsTerminals();
  const productMap = byId(products);
  const customerMap = byId(customers);
  const order = useOpsQuery(['pos-order', id], () => opsPos.order(id));
  const o = order.data;
  const session = useOpsQuery(['pos-sessions', 'of', o?.sessionId], () => opsPos.sessions({}), { enabled: !!o });
  const refunds = useOpsQuery(['pos-orders', 'refunds-of', id], () => opsPos.orders({ refunds: true, limit: 500 }), { enabled: !!o && !o.refundedOrderId });
  const original = useOpsQuery(['pos-order', o?.refundedOrderId], () => opsPos.order(o!.refundedOrderId), { enabled: !!o?.refundedOrderId });
  const [refunding, setRefunding] = useState(false);
  const eReceipt = useOpsMutation(() => opsCompliance.submitReceipt(id), { invalidate: ['e-receipts'], success: 'submitted' });

  if (order.isLoading) return <p className="text-sm text-gray-500">{t('common.loading')}</p>;
  if (!o) return <p className="text-sm text-red-600">{t('common.noData')}</p>;

  const sess = (session.data ?? []).find((s) => s.id === o.sessionId);
  const terminalName = sess ? terminals.find((x) => x.id === sess.terminalId)?.name : undefined;
  const myRefunds = (refunds.data ?? []).filter((r) => r.refundedOrderId === o.id);
  const productName = (pid: string) => (productMap[pid] ? name(productMap[pid]) : pid);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/pos/orders" className="text-sm text-primary-600 hover:underline">
            {t('pos.ordersSearch')}
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">
            {o.refundedOrderId ? t('pos.refundDoc') : t('pos.saleDoc')} {o.orderNumber}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <PrintMenu
            size="md"
            items={[
              { label: tp('print.receipt80'), path: `/print/pos-orders/${o.id}`, params: { paper: '80mm' } },
              { label: tp('print.receiptA4'), path: `/print/pos-orders/${o.id}`, params: { paper: 'a4' } },
            ]}
          />
          <Btn variant="secondary" loading={eReceipt.isPending} onClick={() => eReceipt.mutate(undefined)}>
            {t('pos.eReceipt')}
          </Btn>
          {o.status === 'completed' && !o.refundedOrderId && num(o.totalAmount) > 0 && (
            <Btn variant="warning" onClick={() => setRefunding(true)}>
              {t('pos.refund')}
            </Btn>
          )}
        </div>
      </div>
      <Card>
        <DetailGrid
          items={[
            { label: t('common.date'), value: fmtDateTime(o.createdAt) },
            { label: t('common.status'), value: <Status status={o.status} /> },
            { label: t('common.customer'), value: o.customerId ? name(customerMap[o.customerId]) : t('pos.walkInCustomer') },
            { label: t('pos.terminal'), value: terminalName ?? '-' },
            { label: t('pos.method'), value: t(`pos.methods.${o.paymentMethod}`) },
            { label: t('common.subtotal'), value: fmtMoney(o.subtotal) },
            { label: t('common.tax'), value: fmtMoney(o.taxAmount) },
            { label: t('common.total'), value: fmtMoney(o.totalAmount) },
            { label: t('pos.cashReceived'), value: o.cashReceived != null ? fmtMoney(o.cashReceived) : '-' },
            { label: t('pos.change'), value: o.changeAmount != null ? fmtMoney(o.changeAmount) : '-' },
            { label: t('common.reference'), value: <span className="font-mono text-xs">{o.clientReference ?? '-'}</span> },
            {
              label: t('pos.originalOrder'),
              value: o.refundedOrderId ? (
                <Link href={`/pos/orders/${o.refundedOrderId}`} className="text-primary-600 hover:underline">
                  {original.data?.orderNumber ?? '...'}
                </Link>
              ) : (
                '-'
              ),
            },
          ]}
        />
      </Card>
      <Card title={t('common.lines')}>
        <SimpleTable
          rows={o.lines ?? []}
          columns={[
            { key: 'productId', header: t('common.product'), render: (l) => productName(l.productId) },
            { key: 'quantity', header: t('common.quantity'), render: (l) => fmtQty(l.quantity) },
            { key: 'unitPrice', header: t('common.unitPrice'), render: (l) => fmtMoney(l.unitPrice) },
            { key: 'discount', header: t('pos.discountPct'), render: (l) => fmtQty(l.discount) },
            { key: 'taxRate', header: t('common.taxRate'), render: (l) => `${fmtQty(l.taxRate)}%` },
            { key: 'refundedQty', header: t('pos.refunded'), render: (l) => fmtQty(l.refundedQty) },
            { key: 'lineTotal', header: t('common.lineTotal'), render: (l) => fmtMoney(l.lineTotal) },
          ]}
        />
      </Card>
      {!o.refundedOrderId && (
        <Card title={t('pos.refundsOfOrder')}>
          <SimpleTable
            rows={myRefunds}
            columns={[
              {
                key: 'orderNumber',
                header: t('common.number'),
                render: (r) => (
                  <Link href={`/pos/orders/${r.id}`} className="text-primary-600 hover:underline">
                    {r.orderNumber}
                  </Link>
                ),
              },
              { key: 'createdAt', header: t('common.date'), render: (r) => fmtDateTime(r.createdAt) },
              { key: 'totalAmount', header: t('common.total'), render: (r) => fmtMoney(r.totalAmount) },
            ]}
          />
        </Card>
      )}
      {refunding && <RefundModal order={o} productName={productName} onClose={() => setRefunding(false)} onDone={() => order.refetch()} />}
    </div>
  );
}
