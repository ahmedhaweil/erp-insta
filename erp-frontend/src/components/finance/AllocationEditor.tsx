'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { treasuryService } from '@/services/finance-treasury.service';
import { Btn, Money, Spinner, fmtMoney, inputCls } from './ui';

/**
 * Lists the open invoices of a partner and lets the user type the amount to
 * allocate to each one (with a "fill oldest first" helper).
 */
export default function AllocationEditor({
  partnerType,
  partnerId,
  direction,
  available,
  value,
  onChange,
}: {
  partnerType: 'customer' | 'supplier';
  partnerId: string;
  /** Payment direction: refunds settle credit notes / supplier refunds. */
  direction?: 'inbound' | 'outbound';
  available: number;
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}) {
  const t = useTranslations('payments');
  const tc = useTranslations('common');
  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ['open-invoices', partnerType, partnerId, direction ?? ''],
    queryFn: () => treasuryService.getOpenInvoices(partnerType, partnerId, direction),
    enabled: !!partnerId,
  });

  const allocated = Object.values(value).reduce((s, v) => s + (Number(v) || 0), 0);
  const remaining = Math.round((available - allocated) * 100) / 100;

  const fillOldest = () => {
    let left = available;
    const out: Record<string, string> = {};
    for (const inv of invoices) {
      if (left <= 0) break;
      const amt = Math.min(left, inv.residual);
      out[inv.id] = String(Math.round(amt * 100) / 100);
      left -= amt;
    }
    onChange(out);
  };

  if (!partnerId) return null;
  if (isLoading) return <Spinner />;
  if (!invoices.length) return <p className="text-sm text-gray-500">{t('noOpenInvoices')}</p>;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span>
          {t('allocated')}: <b dir="ltr">{fmtMoney(allocated)}</b> · {t('remaining')}:{' '}
          <b dir="ltr" className={remaining < 0 ? 'text-red-600' : ''}>
            {fmtMoney(remaining)}
          </b>
        </span>
        <div className="flex gap-2">
          <Btn size="sm" variant="secondary" onClick={() => onChange({})}>
            {t('clear')}
          </Btn>
          <Btn size="sm" variant="secondary" onClick={fillOldest}>
            {t('fillOldest')}
          </Btn>
        </div>
      </div>
      <table className="w-full text-sm border border-gray-200 rounded-lg">
        <thead className="bg-gray-50">
          <tr>
            <th className="text-start px-2 py-1.5">{t('invoice')}</th>
            <th className="text-start px-2 py-1.5">{tc('date')}</th>
            <th className="text-start px-2 py-1.5">{t('dueDate')}</th>
            <th className="text-end px-2 py-1.5">{tc('total')}</th>
            <th className="text-end px-2 py-1.5">{t('residual')}</th>
            <th className="text-start px-2 py-1.5 w-36">{t('allocate')}</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr key={inv.id} className="border-t border-gray-100">
              <td className="px-2 py-1">{inv.number}</td>
              <td className="px-2 py-1">{inv.date}</td>
              <td className="px-2 py-1">{inv.dueDate}</td>
              <td className="px-2 py-1 text-end">
                <Money value={inv.total} />
              </td>
              <td className="px-2 py-1 text-end">
                <Money value={inv.residual} />
              </td>
              <td className="px-2 py-1">
                <input
                  type="number"
                  step="any"
                  min="0"
                  max={inv.residual}
                  className={inputCls}
                  value={value[inv.id] ?? ''}
                  onChange={(e) => onChange({ ...value, [inv.id]: e.target.value })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function allocationsFrom(value: Record<string, string>) {
  return Object.entries(value)
    .map(([invoiceId, v]) => ({ invoiceId, amount: Number(v) || 0 }))
    .filter((a) => a.amount > 0);
}
