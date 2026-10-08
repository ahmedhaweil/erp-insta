'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Modal from '@/components/ui/Modal';
import { Btn, Field, inputSm, SelectBox } from '@/components/operations/form';
import { fmtDateTime, fmtMoney, fmtQty, num, SimpleTable } from '@/components/operations/common';
import { useOpsMutation, useOpsQuery, useOpsTerminals } from '@/hooks/use-operations';
import { opsPos } from '@/services/operations-pos.service';
import type { Row } from '@/services/operations-api';

/**
 * Partial refund of a POS order by line. The refund is booked into an open
 * session: the given one (from the till) or one picked from the open sessions.
 */
export default function RefundModal({
  order,
  sessionId,
  productName,
  onClose,
  onDone,
}: {
  order: Row;
  sessionId?: string;
  productName: (id: string) => string;
  onClose: () => void;
  onDone?: () => void;
}) {
  const t = useTranslations('ops');
  const { data: terminals = [] } = useOpsTerminals();
  const openSessions = useOpsQuery(['pos-sessions', 'open'], () => opsPos.sessions({ status: 'open' }), { enabled: !sessionId });
  const [pickedSession, setPickedSession] = useState('');
  const targetSession = sessionId || pickedSession || openSessions.data?.[0]?.id || '';
  const [qty, setQty] = useState<Record<string, string>>({});
  const lines: Row[] = order.lines ?? [];
  const refund = useOpsMutation(
    () =>
      opsPos.refund(order.id, {
        sessionId: targetSession,
        lines: lines.map((l) => ({ productId: l.productId, quantity: num(qty[l.id]) })).filter((l) => l.quantity > 0),
      }),
    {
      invalidate: ['pos-orders', 'pos-summary', 'pos-order'],
      success: 'refundCreated',
      onSuccess: () => {
        setQty({});
        onDone?.();
        onClose();
      },
    },
  );
  const terminalName = (id: string) => terminals.find((x) => x.id === id)?.name ?? '';

  return (
    <Modal isOpen onClose={onClose} title={`${t('pos.refund')} ${order.orderNumber}`} size="lg">
      {!sessionId && (
        <div className="mb-4">
          {openSessions.isLoading ? (
            <p className="text-sm text-gray-500">{t('common.loading')}</p>
          ) : (openSessions.data ?? []).length === 0 ? (
            <p className="text-sm text-amber-700 bg-amber-50 rounded-lg p-3">{t('pos.refundNeedsSession')}</p>
          ) : (
            <Field label={t('pos.refundIntoSession')} hint={t('pos.refundIntoSessionHint')}>
              <SelectBox
                value={targetSession}
                onChange={setPickedSession}
                emptyLabel={false}
                options={(openSessions.data ?? []).map((s) => ({
                  value: s.id,
                  label: `${terminalName(s.terminalId)} - ${fmtDateTime(s.openedAt)}`,
                }))}
              />
            </Field>
          )}
        </div>
      )}
      <SimpleTable
        rows={lines}
        columns={[
          { key: 'product', header: t('common.product'), render: (l) => productName(l.productId) },
          { key: 'quantity', header: t('common.quantity'), render: (l) => fmtQty(l.quantity) },
          { key: 'refundedQty', header: t('pos.refunded'), render: (l) => fmtQty(l.refundedQty) },
          { key: 'lineTotal', header: t('common.lineTotal'), render: (l) => fmtMoney(l.lineTotal) },
          {
            key: 'r',
            header: t('pos.refundQty'),
            render: (l) => (
              <input
                type="number"
                step="any"
                min="0"
                max={num(l.quantity) - num(l.refundedQty)}
                value={qty[l.id] ?? ''}
                onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })}
                className={`${inputSm} w-24`}
              />
            ),
          },
        ]}
      />
      <div className="flex justify-between gap-2 mt-4">
        <Btn variant="secondary" onClick={() => setQty(Object.fromEntries(lines.map((l) => [l.id, String(num(l.quantity) - num(l.refundedQty))])))}>
          {t('pos.refundAll')}
        </Btn>
        <div className="flex gap-2">
          <Btn variant="secondary" onClick={onClose}>
            {t('common.back')}
          </Btn>
          <Btn
            variant="danger"
            loading={refund.isPending}
            disabled={!targetSession || !Object.values(qty).some((v) => num(v) > 0)}
            onClick={() => refund.mutate(undefined)}
          >
            {t('pos.confirmRefund')}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
