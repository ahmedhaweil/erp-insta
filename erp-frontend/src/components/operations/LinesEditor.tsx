'use client';

import { useTranslations } from 'next-intl';
import { Trash2, Plus } from 'lucide-react';
import { inputCls } from './form';
import { byId, fmtMoney, num, useNamer } from './common';
import type { Row } from '@/services/operations-api';

export interface DocLine {
  key: string;
  productId: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  taxRate: string;
}

let seq = 0;
export function newLine(): DocLine {
  seq += 1;
  return { key: `l${Date.now()}-${seq}`, productId: '', quantity: '1', unitPrice: '', discount: '', taxRate: '' };
}

export interface LinesEditorProps {
  lines: DocLine[];
  onChange: (lines: DocLine[]) => void;
  products: Row[];
  /** Product field used to prefill the unit price. */
  priceField?: 'sellPrice' | 'costPrice';
  /** Product field used to prefill the tax rate. */
  taxField?: 'salesTaxRate' | 'purchaseTaxRate';
  showPrice?: boolean;
  showDiscount?: boolean;
  showTax?: boolean;
  /** Hint shown under the price column (e.g. "empty = price list"). */
  priceHint?: string;
}

export function lineTotals(lines: DocLine[]) {
  let subtotal = 0;
  let tax = 0;
  for (const l of lines) {
    const net = num(l.quantity) * num(l.unitPrice) - num(l.discount);
    subtotal += net;
    tax += (net * num(l.taxRate)) / 100;
  }
  return { subtotal, tax, total: subtotal + tax };
}

/** Lines -> API payload (empty price/discount/tax are omitted so the backend defaults apply). */
export function linesPayload(lines: DocLine[], opts: { requirePrice?: boolean } = {}) {
  return lines
    .filter((l) => l.productId && num(l.quantity) > 0)
    .map((l) => {
      const out: Record<string, any> = { productId: l.productId, quantity: num(l.quantity) };
      if (l.unitPrice !== '' || opts.requirePrice) out.unitPrice = num(l.unitPrice);
      if (l.discount !== '') out.discount = num(l.discount);
      if (l.taxRate !== '') out.taxRate = num(l.taxRate);
      return out;
    });
}

export default function LinesEditor({
  lines,
  onChange,
  products,
  priceField = 'sellPrice',
  taxField = 'salesTaxRate',
  showPrice = true,
  showDiscount = true,
  showTax = true,
  priceHint,
}: LinesEditorProps) {
  const t = useTranslations('ops');
  const name = useNamer();
  const productMap = byId(products);

  const update = (key: string, patch: Partial<DocLine>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const pickProduct = (key: string, productId: string) => {
    const p = productMap[productId];
    update(key, {
      productId,
      unitPrice: p && showPrice ? String(num(p[priceField])) : '',
      taxRate: p && showTax ? String(num(p[taxField])) : '',
    });
  };

  const totals = lineTotals(lines);

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200 text-gray-600">
              <th className="text-start px-2 py-2 font-medium min-w-[200px]">{t('common.product')}</th>
              <th className="text-start px-2 py-2 font-medium w-24">{t('common.quantity')}</th>
              {showPrice && <th className="text-start px-2 py-2 font-medium w-28">{t('common.unitPrice')}</th>}
              {showDiscount && <th className="text-start px-2 py-2 font-medium w-24">{t('common.discountAmount')}</th>}
              {showTax && <th className="text-start px-2 py-2 font-medium w-20">{t('common.taxRate')}</th>}
              {showPrice && <th className="text-start px-2 py-2 font-medium w-28">{t('common.lineTotal')}</th>}
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key} className="border-b border-gray-100 last:border-0">
                <td className="px-2 py-1.5">
                  <select value={l.productId} onChange={(e) => pickProduct(l.key, e.target.value)} className={inputCls}>
                    <option value="">{t('common.selectProduct')}</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.code} - {name(p)}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  <input type="number" step="any" min="0" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} className={inputCls} />
                </td>
                {showPrice && (
                  <td className="px-2 py-1.5">
                    <input type="number" step="any" min="0" value={l.unitPrice} onChange={(e) => update(l.key, { unitPrice: e.target.value })} className={inputCls} placeholder={priceHint ? t('common.auto') : undefined} />
                  </td>
                )}
                {showDiscount && (
                  <td className="px-2 py-1.5">
                    <input type="number" step="any" min="0" value={l.discount} onChange={(e) => update(l.key, { discount: e.target.value })} className={inputCls} />
                  </td>
                )}
                {showTax && (
                  <td className="px-2 py-1.5">
                    <input type="number" step="any" min="0" max="100" value={l.taxRate} onChange={(e) => update(l.key, { taxRate: e.target.value })} className={inputCls} />
                  </td>
                )}
                {showPrice && (
                  <td className="px-2 py-1.5 text-gray-700">
                    {fmtMoney(num(l.quantity) * num(l.unitPrice) - num(l.discount))}
                  </td>
                )}
                <td className="px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => onChange(lines.filter((x) => x.key !== l.key))}
                    className="p-1 text-red-500 hover:bg-red-50 rounded"
                    aria-label={t('common.remove')}
                  >
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <button
          type="button"
          onClick={() => onChange([...lines, newLine()])}
          className="inline-flex items-center gap-1 text-sm text-primary-600 hover:underline"
        >
          <Plus size={16} /> {t('common.addLine')}
        </button>
        {showPrice && (
          <div className="text-sm space-y-0.5 min-w-[200px]">
            {priceHint && <p className="text-xs text-gray-500 mb-1">{priceHint}</p>}
            <div className="flex justify-between gap-6">
              <span className="text-gray-500">{t('common.subtotal')}</span>
              <span>{fmtMoney(totals.subtotal)}</span>
            </div>
            {showTax && (
              <div className="flex justify-between gap-6">
                <span className="text-gray-500">{t('common.tax')}</span>
                <span>{fmtMoney(totals.tax)}</span>
              </div>
            )}
            <div className="flex justify-between gap-6 font-semibold">
              <span>{t('common.total')}</span>
              <span>{fmtMoney(totals.total)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
