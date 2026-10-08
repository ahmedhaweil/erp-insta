'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Modal from '@/components/ui/Modal';
import { Btn, EntityForm, inputCls, type FieldDef } from './form';
import { fmtQty, num, SimpleTable } from './common';

export interface QtyLine {
  id: string;
  label: string;
  /** Quantity already processed / ordered, shown for reference. */
  info?: string;
  max: number;
  initial: number;
}

/**
 * Modal for partial operations (deliver, receive, credit note, refund...):
 * a few header fields plus a quantity per line. Lines left at zero are omitted.
 */
export default function LineQtyModal({
  title,
  lines,
  fields = [],
  initial,
  infoHeader,
  submitLabel,
  loading,
  onClose,
  onSubmit,
}: {
  title: string;
  lines: QtyLine[];
  fields?: FieldDef[];
  initial?: Record<string, any>;
  infoHeader?: string;
  submitLabel?: string;
  loading?: boolean;
  onClose: () => void;
  onSubmit: (header: Record<string, any>, lines: { id: string; quantity: number }[]) => void;
}) {
  const t = useTranslations('ops');
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.id, String(l.initial)])));
  return (
    <Modal isOpen onClose={onClose} title={title} size="xl">
      <EntityForm
        fields={fields}
        initial={initial}
        loading={loading}
        submitLabel={submitLabel}
        onCancel={onClose}
        onSubmit={(header) =>
          onSubmit(
            header,
            lines.map((l) => ({ id: l.id, quantity: num(qty[l.id]) })).filter((l) => l.quantity > 0),
          )
        }
      >
        <SimpleTable
          rows={lines}
          columns={[
            { key: 'label', header: t('common.product') },
            ...(infoHeader ? [{ key: 'info', header: infoHeader }] : []),
            { key: 'max', header: t('common.residual'), render: (l: QtyLine) => fmtQty(l.max) },
            {
              key: 'qty',
              header: t('common.quantity'),
              render: (l: QtyLine) => (
                <input
                  type="number"
                  step="any"
                  min="0"
                  max={l.max}
                  value={qty[l.id] ?? ''}
                  onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })}
                  className={`${inputCls} w-28`}
                />
              ),
            },
          ]}
        />
        <div className="flex gap-2">
          <Btn size="sm" variant="secondary" onClick={() => setQty(Object.fromEntries(lines.map((l) => [l.id, String(l.max)])))}>
            {t('common.fillAll')}
          </Btn>
          <Btn size="sm" variant="secondary" onClick={() => setQty(Object.fromEntries(lines.map((l) => [l.id, '0'])))}>
            {t('common.clearAll')}
          </Btn>
        </div>
      </EntityForm>
    </Modal>
  );
}
