'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { clsx } from 'clsx';
import Modal from '@/components/ui/Modal';
import { Btn, EntityForm, Field, inputCls } from '@/components/operations/form';
import { DetailGrid, fmtDateTime, fmtMoney, fmtQty, num, SimpleTable, Status, Stat } from '@/components/operations/common';
import { useOpsMutation, useOpsQuery } from '@/hooks/use-operations';
import { opsPos } from '@/services/operations-pos.service';
import { opsCompliance } from '@/services/operations-compliance.service';
import type { Row } from '@/services/operations-api';

export type PayMethod = 'cash' | 'card' | 'split';

/** Tender screen: cash / card / split with change calculation. */
export function PaymentModal({
  total,
  loading,
  onClose,
  onPay,
}: {
  total: number;
  loading?: boolean;
  onClose: () => void;
  onPay: (p: { method: PayMethod; cashReceived?: number; cashAmount?: number }) => void;
}) {
  const t = useTranslations('ops');
  const [method, setMethod] = useState<PayMethod>('cash');
  const [received, setReceived] = useState(total.toFixed(2));
  const [cashPart, setCashPart] = useState('');
  const cashDue = method === 'cash' ? total : method === 'split' ? Math.min(num(cashPart), total) : 0;
  const change = method === 'card' ? 0 : Math.max(0, num(received) - cashDue);
  const short = method !== 'card' && num(received) + 0.0001 < cashDue;
  const quick = [total, Math.ceil(total / 10) * 10, Math.ceil(total / 50) * 50, Math.ceil(total / 100) * 100, Math.ceil(total / 200) * 200]
    .filter((v, i, a) => v > 0 && a.indexOf(v) === i);

  const submit = () => {
    if (short) return;
    if (method === 'card') onPay({ method });
    else if (method === 'cash') onPay({ method, cashReceived: num(received) });
    else onPay({ method, cashAmount: cashDue, cashReceived: num(received) });
  };

  return (
    <Modal isOpen onClose={onClose} title={t('pos.payment')} size="lg">
      <div className="space-y-4">
        <div className="text-center">
          <div className="text-sm text-gray-500">{t('pos.amountDue')}</div>
          <div className="text-4xl font-bold text-gray-900">{fmtMoney(total)}</div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(['cash', 'card', 'split'] as PayMethod[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMethod(m)}
              className={clsx(
                'py-4 rounded-xl text-lg font-semibold border-2 transition',
                method === m ? 'border-primary-600 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-700 hover:bg-gray-50',
              )}
            >
              {t(`pos.methods.${m}`)}
            </button>
          ))}
        </div>
        {method === 'split' && (
          <Field label={t('pos.cashPart')} hint={`${t('pos.cardPart')}: ${fmtMoney(Math.max(0, total - num(cashPart)))}`}>
            <input type="number" step="any" min="0" max={total} value={cashPart} onChange={(e) => { setCashPart(e.target.value); setReceived(e.target.value); }} className={`${inputCls} text-xl py-3`} />
          </Field>
        )}
        {method !== 'card' && (
          <>
            <Field label={t('pos.cashReceived')}>
              <input autoFocus type="number" step="any" min="0" value={received} onChange={(e) => setReceived(e.target.value)} className={`${inputCls} text-2xl py-3`} />
            </Field>
            <div className="flex flex-wrap gap-2">
              {quick.map((v) => (
                <button key={v} type="button" onClick={() => setReceived(v.toFixed(2))} className="px-4 py-3 rounded-lg bg-gray-100 hover:bg-gray-200 text-lg font-medium">
                  {fmtMoney(v)}
                </button>
              ))}
            </div>
            <div className={clsx('text-center text-2xl font-semibold', short ? 'text-red-600' : 'text-green-700')}>
              {short ? t('pos.insufficientCash') : `${t('pos.change')}: ${fmtMoney(change)}`}
            </div>
          </>
        )}
        <div className="flex gap-2">
          <Btn variant="secondary" size="lg" className="flex-1" onClick={onClose}>{t('common.cancel')}</Btn>
          <Btn variant="success" size="lg" className="flex-[2]" disabled={short} loading={loading} onClick={submit}>
            {t('pos.completeSale')}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

/** Session orders with partial refunds by line. */
export function OrdersModal({
  sessionId,
  productName,
  onClose,
}: {
  sessionId: string;
  productName: (id: string) => string;
  onClose: () => void;
}) {
  const t = useTranslations('ops');
  const { data: orders = [], isLoading } = useOpsQuery(['pos-orders', sessionId], () => opsPos.sessionOrders(sessionId));
  const [refunding, setRefunding] = useState<Row | null>(null);
  const eReceipt = useOpsMutation((id: string) => opsCompliance.submitReceipt(id), { invalidate: ['e-receipts'], success: 'submitted' });
  const [qty, setQty] = useState<Record<string, string>>({});
  const refund = useOpsMutation(
    () =>
      opsPos.refund(refunding!.id, {
        sessionId,
        lines: (refunding!.lines ?? [])
          .map((l: any) => ({ productId: l.productId, quantity: num(qty[l.id]) }))
          .filter((l: any) => l.quantity > 0),
      }),
    { invalidate: ['pos-orders', 'pos-summary'], success: 'refundCreated', onSuccess: () => { setRefunding(null); setQty({}); } },
  );

  if (refunding) {
    return (
      <Modal isOpen onClose={() => setRefunding(null)} title={`${t('pos.refund')} ${refunding.orderNumber}`} size="lg">
        <SimpleTable
          rows={refunding.lines ?? []}
          columns={[
            { key: 'product', header: t('common.product'), render: (l) => productName(l.productId) },
            { key: 'quantity', header: t('common.quantity'), render: (l) => fmtQty(l.quantity) },
            { key: 'refundedQty', header: t('pos.refunded'), render: (l) => fmtQty(l.refundedQty) },
            { key: 'lineTotal', header: t('common.lineTotal'), render: (l) => fmtMoney(l.lineTotal) },
            {
              key: 'r',
              header: t('pos.refundQty'),
              render: (l) => (
                <input type="number" step="any" min="0" max={num(l.quantity) - num(l.refundedQty)} value={qty[l.id] ?? ''} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} className={`${inputCls} w-24`} />
              ),
            },
          ]}
        />
        <div className="flex justify-between gap-2 mt-4">
          <Btn variant="secondary" onClick={() => setQty(Object.fromEntries((refunding.lines ?? []).map((l: any) => [l.id, String(num(l.quantity) - num(l.refundedQty))])))}>
            {t('pos.refundAll')}
          </Btn>
          <div className="flex gap-2">
            <Btn variant="secondary" onClick={() => setRefunding(null)}>{t('common.back')}</Btn>
            <Btn variant="danger" loading={refund.isPending} disabled={!Object.values(qty).some((v) => num(v) > 0)} onClick={() => refund.mutate(undefined)}>
              {t('pos.confirmRefund')}
            </Btn>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal isOpen onClose={onClose} title={t('pos.sessionOrders')} size="xl">
      {isLoading ? (
        <p className="text-sm text-gray-500">{t('common.loading')}</p>
      ) : (
        <SimpleTable
          rows={orders}
          columns={[
            { key: 'orderNumber', header: t('common.number') },
            { key: 'createdAt', header: t('common.date'), render: (o) => fmtDateTime(o.createdAt) },
            { key: 'paymentMethod', header: t('pos.method'), render: (o) => t(`pos.methods.${o.paymentMethod}`) },
            { key: 'totalAmount', header: t('common.total'), render: (o) => fmtMoney(o.totalAmount) },
            { key: 'status', header: t('common.status'), render: (o) => <Status status={o.status} /> },
            {
              key: 'x',
              header: '',
              render: (o) => (
                <div className="flex gap-2">
                  {o.status === 'completed' && num(o.totalAmount) > 0 && (
                    <Btn size="sm" variant="warning" onClick={() => setRefunding(o)}>{t('pos.refund')}</Btn>
                  )}
                  <Btn size="sm" variant="secondary" loading={eReceipt.isPending && eReceipt.variables === o.id} onClick={() => eReceipt.mutate(o.id)}>
                    {t('pos.eReceipt')}
                  </Btn>
                </div>
              ),
            },
          ]}
        />
      )}
    </Modal>
  );
}

/** Cash in / cash out of the drawer. */
export function CashModal({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const t = useTranslations('ops');
  const { data: moves = [] } = useOpsQuery(['pos-cash', sessionId], () => opsPos.cashMovements(sessionId));
  const add = useOpsMutation((body: any) => opsPos.addCashMovement(sessionId, body), { invalidate: ['pos-cash', 'pos-summary'] });
  return (
    <Modal isOpen onClose={onClose} title={t('pos.cashInOut')} size="lg">
      <EntityForm
        key={moves.length}
        fields={[
          { name: 'type', label: t('common.type'), type: 'select', required: true, options: [{ value: 'in', label: t('pos.cashIn') }, { value: 'out', label: t('pos.cashOut') }] },
          { name: 'amount', label: t('common.amount'), type: 'number', required: true, min: 0.01 },
          { name: 'reason', label: t('common.reason'), required: true, wide: true },
        ]}
        initial={{ type: 'out' }}
        submitLabel={t('common.add')}
        loading={add.isPending}
        onCancel={onClose}
        onSubmit={(p) => add.mutate(p)}
      />
      <div className="mt-4">
        <SimpleTable
          rows={moves}
          columns={[
            { key: 'createdAt', header: t('common.date'), render: (m) => fmtDateTime(m.createdAt) },
            { key: 'type', header: t('common.type'), render: (m) => (m.type === 'in' ? t('pos.cashIn') : t('pos.cashOut')) },
            { key: 'amount', header: t('common.amount'), render: (m) => fmtMoney(m.amount) },
            { key: 'reason', header: t('common.reason') },
          ]}
        />
      </div>
    </Modal>
  );
}

/** Session report (X report while open, Z report after closing). */
export function SessionReport({ summary, session }: { summary: any; session?: any }) {
  const t = useTranslations('ops');
  if (!summary) return null;
  const diff = session?.cashDifference ?? summary.cashDifference;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label={t('pos.ordersCount')} value={summary.totalOrders} />
        <Stat label={t('pos.totalSales')} value={fmtMoney(summary.totalSales)} />
        <Stat label={t('pos.totalRefunds')} value={fmtMoney(summary.totalRefunds)} tone="red" />
        <Stat label={t('pos.totalDiscount')} value={fmtMoney(summary.totalDiscount)} />
      </div>
      <DetailGrid
        items={[
          { label: t('common.tax'), value: fmtMoney(summary.totalTax) },
          { label: t('pos.cashSales'), value: fmtMoney(summary.cashSales) },
          { label: t('pos.cardSales'), value: fmtMoney(summary.cardSales) },
          { label: t('pos.openingCash'), value: fmtMoney(summary.openingCash) },
          { label: t('pos.cashIn'), value: fmtMoney(summary.cashIn) },
          { label: t('pos.cashOut'), value: fmtMoney(summary.cashOut) },
          { label: t('pos.expectedCash'), value: fmtMoney(session?.expectedCash ?? summary.expectedCash) },
          { label: t('pos.countedCash'), value: summary.closingCash != null || session?.closingCash != null ? fmtMoney(session?.closingCash ?? summary.closingCash) : '-' },
          {
            label: t('pos.difference'),
            value: diff != null ? <span className={num(diff) < 0 ? 'text-red-600' : num(diff) > 0 ? 'text-green-700' : ''}>{fmtMoney(diff)}</span> : '-',
          },
        ]}
      />
    </div>
  );
}

/** Close the session with the counted cash; shows the Z report afterwards. */
export function CloseSessionModal({ sessionId, onClose, onClosed }: { sessionId: string; onClose: () => void; onClosed: () => void }) {
  const t = useTranslations('ops');
  const { data: summary } = useOpsQuery(['pos-summary', sessionId], () => opsPos.summary(sessionId));
  const [counted, setCounted] = useState('');
  const [closed, setClosed] = useState<any>(null);
  const close = useOpsMutation(() => opsPos.closeSession(sessionId, num(counted)), {
    invalidate: ['pos-summary'],
    success: 'sessionClosed',
    onSuccess: (s) => setClosed(s),
  });
  const expected = num(summary?.expectedCash);
  return (
    <Modal isOpen onClose={closed ? onClosed : onClose} title={closed ? t('pos.zReport') : t('pos.closeSession')} size="xl">
      <div className="space-y-4 print:text-black">
        <SessionReport summary={closed ? { ...summary, closingCash: closed.closingCash, cashDifference: closed.cashDifference } : summary} session={closed} />
        {!closed ? (
          <>
            <Field label={t('pos.countedCash')} hint={counted !== '' ? `${t('pos.difference')}: ${fmtMoney(num(counted) - expected)}` : undefined}>
              <input autoFocus type="number" step="any" min="0" value={counted} onChange={(e) => setCounted(e.target.value)} className={`${inputCls} text-2xl py-3`} />
            </Field>
            <div className="flex justify-end gap-2">
              <Btn variant="secondary" onClick={onClose}>{t('common.cancel')}</Btn>
              <Btn variant="danger" disabled={counted === ''} loading={close.isPending} onClick={() => close.mutate(undefined)}>
                {t('pos.closeSession')}
              </Btn>
            </div>
          </>
        ) : (
          <div className="flex justify-end gap-2 print:hidden">
            <Btn variant="secondary" onClick={() => window.print()}>{t('common.print')}</Btn>
            <Btn onClick={onClosed}>{t('common.close')}</Btn>
          </div>
        )}
      </div>
    </Modal>
  );
}
