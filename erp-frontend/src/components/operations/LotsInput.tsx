'use client';

import { useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import { inputCls } from './form';
import { num } from './common';

export interface LotDraft {
  lotNumber: string;
  quantity: string;
  expiryDate: string;
}

export function lotsPayload(lots: LotDraft[]) {
  return lots
    .filter((l) => l.lotNumber.trim() && num(l.quantity) > 0)
    .map((l) => ({ lotNumber: l.lotNumber.trim(), quantity: num(l.quantity), expiryDate: l.expiryDate || undefined }));
}

/** Editor for the lots / serial numbers of a tracked product on a stock move. */
export default function LotsInput({
  lots,
  onChange,
  showExpiry = true,
}: {
  lots: LotDraft[];
  onChange: (lots: LotDraft[]) => void;
  showExpiry?: boolean;
}) {
  const t = useTranslations('ops');
  const update = (i: number, patch: Partial<LotDraft>) => onChange(lots.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-2">
      {lots.map((l, i) => (
        <div key={i} className="flex gap-2 items-center">
          <input placeholder={t('inv.lotNumber')} value={l.lotNumber} onChange={(e) => update(i, { lotNumber: e.target.value })} className={inputCls} />
          <input type="number" step="any" min="0" placeholder={t('common.quantity')} value={l.quantity} onChange={(e) => update(i, { quantity: e.target.value })} className={`${inputCls} max-w-[120px]`} />
          {showExpiry && (
            <input type="date" title={t('inv.expiryDate')} value={l.expiryDate} onChange={(e) => update(i, { expiryDate: e.target.value })} className={`${inputCls} max-w-[170px]`} />
          )}
          <button type="button" onClick={() => onChange(lots.filter((_, idx) => idx !== i))} className="p-1 text-red-500" aria-label={t('common.remove')}>
            <Trash2 size={16} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...lots, { lotNumber: '', quantity: '', expiryDate: '' }])}
        className="inline-flex items-center gap-1 text-sm text-primary-600 hover:underline"
      >
        <Plus size={16} /> {t('inv.addLot')}
      </button>
    </div>
  );
}
