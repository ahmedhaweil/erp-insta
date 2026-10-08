'use client';

import { useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Btn, Field, inputCls, SelectBox, toOptions } from '@/components/operations/form';
import { Card, DetailGrid, fmtDate, fmtMoney, fmtQty, num, SimpleTable, Stat, Status, useNamer } from '@/components/operations/common';
import { useOpsMutation, useOpsProducts, useOpsQuery } from '@/hooks/use-operations';
import { opsInventory } from '@/services/operations-inventory.service';

/** Count entry (manual or barcode), differences and validation of one stock count. */
export default function StockCountDetailPage() {
  const t = useTranslations('ops');
  const name = useNamer();
  const { id } = useParams<{ id: string }>();
  const { data: count, isLoading } = useOpsQuery(['stock-count', id], () => opsInventory.count(id));
  const { data: products = [] } = useOpsProducts();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [barcode, setBarcode] = useState('');
  const [scanQty, setScanQty] = useState('1');
  const [accumulate, setAccumulate] = useState(true);
  const [zeroUncounted, setZeroUncounted] = useState(false);
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [extra, setExtra] = useState({ productId: '', lotNumber: '', expiryDate: '', countedQty: '' });
  const barcodeRef = useRef<HTMLInputElement>(null);

  const inv = ['stock-count', 'stock-counts'];
  const saveLines = useOpsMutation((lines: any[]) => opsInventory.updateCountLines(id, lines), {
    invalidate: inv,
    onSuccess: () => setEdits({}),
  });
  const scan = useOpsMutation(
    () => opsInventory.updateCountLines(id, [{ barcode: barcode.trim(), countedQty: num(scanQty), accumulate }]),
    {
      invalidate: inv,
      success: 'counted',
      onSuccess: () => {
        setBarcode('');
        barcodeRef.current?.focus();
      },
    },
  );
  const addExtra = useOpsMutation(
    () =>
      opsInventory.updateCountLines(id, [
        {
          productId: extra.productId,
          lotNumber: extra.lotNumber || undefined,
          expiryDate: extra.expiryDate || undefined,
          countedQty: num(extra.countedQty),
        },
      ]),
    { invalidate: inv, onSuccess: () => setExtra({ productId: '', lotNumber: '', expiryDate: '', countedQty: '' }) },
  );
  const validate = useOpsMutation(() => opsInventory.validateCount(id, { zeroUncounted }), { invalidate: inv, success: 'validated' });
  const cancel = useOpsMutation(() => opsInventory.cancelCount(id), { invalidate: inv, success: 'cancelled' });

  if (isLoading || !count) return <p className="text-sm text-gray-500">{t('common.loading')}</p>;

  const open = count.status === 'open';
  const summary = count.summary ?? {};
  const lines: any[] = (count.lines ?? []).filter((l: any) => !onlyDiff || (l.differenceQty != null && num(l.differenceQty) !== 0));
  const dirty = Object.keys(edits).length > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href="/inventory/stock-counts" className="text-sm text-primary-600 hover:underline">
            {t('inv.stockCounts')}
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">
            {t('inv.count')} {count.countNumber}
          </h1>
        </div>
        {open && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={zeroUncounted} onChange={(e) => setZeroUncounted(e.target.checked)} />
              {t('inv.zeroUncounted')}
            </label>
            <Btn variant="success" loading={validate.isPending} disabled={dirty} onClick={() => validate.mutate(undefined)}>
              {t('inv.validateCount')}
            </Btn>
            <Btn variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate(undefined)}>
              {t('common.cancel')}
            </Btn>
          </div>
        )}
      </div>

      <Card>
        <DetailGrid
          items={[
            { label: t('common.date'), value: fmtDate(count.date) },
            { label: t('common.warehouse'), value: name(count.warehouse) },
            { label: t('common.status'), value: <Status status={count.status} /> },
            { label: t('common.notes'), value: count.notes || '-' },
          ]}
        />
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Stat label={t('inv.totalLines')} value={summary.totalLines ?? 0} />
        <Stat label={t('inv.countedLines')} value={summary.countedLines ?? 0} />
        <Stat label={t('inv.uncountedLines')} value={summary.uncountedLines ?? 0} tone={summary.uncountedLines ? 'amber' : undefined} />
        <Stat label={t('inv.gainValue')} value={fmtMoney(summary.gainValue)} tone="green" />
        <Stat label={t('inv.lossValue')} value={fmtMoney(summary.lossValue)} tone="red" />
        <Stat label={t('inv.netValue')} value={fmtMoney(summary.netValue ?? count.differenceValue)} />
      </div>

      {(count.warnings ?? []).length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800 space-y-1">
          {count.warnings.map((w: any, i: number) => (
            <p key={i}>{typeof w === 'string' ? w : w.message ?? JSON.stringify(w)}</p>
          ))}
        </div>
      )}

      {open && (
        <Card title={t('inv.barcodeEntry')}>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (barcode.trim()) scan.mutate(undefined);
            }}
          >
            <Field label={t('inv.barcode')} className="flex-1 min-w-[220px]">
              <input ref={barcodeRef} autoFocus value={barcode} onChange={(e) => setBarcode(e.target.value)} className={inputCls} placeholder={t('inv.scanBarcode')} />
            </Field>
            <Field label={t('common.quantity')} className="w-28">
              <input type="number" step="any" min="0" value={scanQty} onChange={(e) => setScanQty(e.target.value)} className={inputCls} />
            </Field>
            <label className="flex items-center gap-2 text-sm pb-2">
              <input type="checkbox" checked={accumulate} onChange={(e) => setAccumulate(e.target.checked)} />
              {t('inv.accumulate')}
            </label>
            <Btn type="submit" loading={scan.isPending}>{t('inv.addCount')}</Btn>
          </form>
        </Card>
      )}

      <Card
        title={t('inv.countLines')}
        actions={
          <>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />
              {t('inv.onlyDifferences')}
            </label>
            {open && (
              <Btn
                size="sm"
                disabled={!dirty}
                loading={saveLines.isPending}
                onClick={() =>
                  saveLines.mutate(
                    Object.entries(edits)
                      .filter(([, v]) => v !== '')
                      .map(([lineId, v]) => ({ lineId, countedQty: num(v) })),
                  )
                }
              >
                {t('inv.saveCounts')}
              </Btn>
            )}
          </>
        }
      >
        <SimpleTable
          rows={lines}
          columns={[
            { key: 'productCode', header: t('common.code') },
            { key: 'productName', header: t('common.product') },
            { key: 'lotNumber', header: t('inv.lotNumber'), render: (l) => l.lotNumber || '-' },
            { key: 'expiryDate', header: t('inv.expiryDate'), render: (l) => fmtDate(l.expiryDate) },
            { key: 'systemQty', header: t('inv.systemQty'), render: (l) => fmtQty(l.systemQty) },
            {
              key: 'countedQty',
              header: t('inv.countedQty'),
              render: (l) =>
                open ? (
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={edits[l.id] ?? (l.countedQty == null ? '' : String(num(l.countedQty)))}
                    onChange={(e) => setEdits({ ...edits, [l.id]: e.target.value })}
                    className={`${inputCls} w-28`}
                  />
                ) : l.countedQty == null ? '-' : fmtQty(l.countedQty),
            },
            {
              key: 'differenceQty',
              header: t('inv.differenceQty'),
              render: (l) =>
                l.differenceQty == null ? '-' : (
                  <span className={num(l.differenceQty) < 0 ? 'text-red-600' : num(l.differenceQty) > 0 ? 'text-green-700' : ''}>
                    {fmtQty(l.differenceQty)}
                  </span>
                ),
            },
            { key: 'differenceValue', header: t('inv.differenceValue'), render: (l) => (l.differenceValue == null ? '-' : fmtMoney(l.differenceValue)) },
            {
              key: 'moved',
              header: '',
              render: (l) => (l.movedSinceSnapshot ? <span className="text-xs text-amber-700" title={t('inv.movedSinceSnapshotHint')}>{t('inv.movedSinceSnapshot')}</span> : null),
            },
          ]}
        />
      </Card>

      {open && (
        <Card title={t('inv.addCountLine')}>
          <form
            className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (extra.productId && extra.countedQty !== '') addExtra.mutate(undefined);
            }}
          >
            <Field label={t('common.product')} required>
              <SelectBox value={extra.productId} onChange={(v) => setExtra({ ...extra, productId: v })} required options={toOptions(products, name)} />
            </Field>
            <Field label={t('inv.lotNumber')}>
              <input value={extra.lotNumber} onChange={(e) => setExtra({ ...extra, lotNumber: e.target.value })} className={inputCls} />
            </Field>
            <Field label={t('inv.expiryDate')}>
              <input type="date" value={extra.expiryDate} onChange={(e) => setExtra({ ...extra, expiryDate: e.target.value })} className={inputCls} />
            </Field>
            <Field label={t('inv.countedQty')} required>
              <input type="number" step="any" min="0" required value={extra.countedQty} onChange={(e) => setExtra({ ...extra, countedQty: e.target.value })} className={inputCls} />
            </Field>
            <Btn type="submit" loading={addExtra.isPending}>{t('common.add')}</Btn>
          </form>
        </Card>
      )}
    </div>
  );
}
