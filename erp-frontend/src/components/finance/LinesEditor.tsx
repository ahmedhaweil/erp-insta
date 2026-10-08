'use client';

import { useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';
import AccountPicker from './AccountPicker';
import { Btn, fmtMoney, inputCls, useLocalName } from './ui';
import { useCostCenters } from '@/hooks/use-finance';

export type DrCrLine = { accountId: string; debit: string; credit: string; description: string; costCenterId: string };
export const emptyDrCr = (): DrCrLine => ({ accountId: '', debit: '', credit: '', description: '', costCenterId: '' });

export const drCrTotals = (lines: DrCrLine[]) => {
  const debit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const credit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  return { debit, credit, diff: Math.round((debit - credit) * 100) / 100 };
};

export const drCrValid = (lines: DrCrLine[]) => lines.every((l) => l.accountId && (Number(l.debit) > 0) !== (Number(l.credit) > 0));

export const drCrPayload = (lines: DrCrLine[]) =>
  lines.map((l) => ({
    accountId: l.accountId,
    debit: Number(l.debit) || 0,
    credit: Number(l.credit) || 0,
    description: l.description || undefined,
    costCenterId: l.costCenterId || undefined,
  }));

/** Debit / credit lines with account, description and cost center (recurring entries, opening balances). */
export default function LinesEditor({
  lines,
  onChange,
  minLines = 1,
  showBalance = true,
}: {
  lines: DrCrLine[];
  onChange: (lines: DrCrLine[]) => void;
  minLines?: number;
  showBalance?: boolean;
}) {
  const t = useTranslations('acct');
  const tc = useTranslations('common');
  const name = useLocalName();
  const { data: costCenters = [] } = useCostCenters();
  const set = (i: number, patch: Partial<DrCrLine>) => onChange(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const totals = drCrTotals(lines);
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50">
              <th className="text-start px-2 py-2 w-[32%]">{t('account')}</th>
              <th className="text-start px-2 py-2">{tc('description')}</th>
              <th className="text-start px-2 py-2 w-40">{t('costCenter')}</th>
              <th className="text-start px-2 py-2 w-28">{t('debit')}</th>
              <th className="text-start px-2 py-2 w-28">{t('credit')}</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-b border-gray-100">
                <td className="px-2 py-1.5">
                  <AccountPicker value={l.accountId} onChange={(id) => set(i, { accountId: id })} />
                </td>
                <td className="px-2 py-1.5">
                  <input className={inputCls} value={l.description} onChange={(e) => set(i, { description: e.target.value })} />
                </td>
                <td className="px-2 py-1.5">
                  <select className={inputCls} value={l.costCenterId} onChange={(e) => set(i, { costCenterId: e.target.value })}>
                    <option value="">-</option>
                    {costCenters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} - {name(c)}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="number"
                    step="any"
                    min="0"
                    className={inputCls}
                    value={l.debit}
                    onChange={(e) => set(i, { debit: e.target.value, credit: e.target.value ? '' : l.credit })}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="number"
                    step="any"
                    min="0"
                    className={inputCls}
                    value={l.credit}
                    onChange={(e) => set(i, { credit: e.target.value, debit: e.target.value ? '' : l.debit })}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <button
                    type="button"
                    disabled={lines.length <= minLines}
                    onClick={() => onChange(lines.filter((_, idx) => idx !== i))}
                    className="p-1 text-gray-400 hover:text-red-600 disabled:opacity-30"
                    aria-label={tc('delete')}
                  >
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className="px-2 py-2">
                <Btn size="sm" variant="ghost" onClick={() => onChange([...lines, emptyDrCr()])}>
                  <Plus size={14} /> {t('addLine')}
                </Btn>
              </td>
              <td className="px-2 py-2 text-end" colSpan={2}>
                {tc('total')}
              </td>
              <td className="px-2 py-2 tabular-nums" dir="ltr">
                {fmtMoney(totals.debit)}
              </td>
              <td className="px-2 py-2 tabular-nums" dir="ltr">
                {fmtMoney(totals.credit)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      {showBalance && (
        <div
          className={clsx(
            'text-sm rounded-lg px-3 py-2',
            totals.diff === 0 && totals.debit > 0 ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-800',
          )}
        >
          {totals.diff === 0 && totals.debit > 0 ? t('balanced') : t('unbalancedBy', { amount: fmtMoney(Math.abs(totals.diff)) })}
        </div>
      )}
    </div>
  );
}
