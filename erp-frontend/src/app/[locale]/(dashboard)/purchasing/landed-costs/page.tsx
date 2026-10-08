'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import AccountPicker, { useAccountLabel } from '@/components/finance/AccountPicker';
import { Btn, Field, inputCls, SelectBox } from '@/components/operations/form';
import {
  byId,
  DetailGrid,
  fmtDate,
  fmtMoney,
  fmtQty,
  num,
  RowAction,
  RowActions,
  SimpleTable,
  Status,
  today,
  useModal,
  useNamer,
} from '@/components/operations/common';
import { useOpsMutation, useOpsProducts, useOpsQuery, useOpsSuppliers } from '@/hooks/use-operations';
import { opsPurchasing } from '@/services/operations-purchasing.service';
import type { Row } from '@/services/operations-api';

type Split = 'by_value' | 'by_quantity' | 'equal';
type ChargeDraft = { description: string; amount: string; accountId: string };
const emptyCharge = (): ChargeDraft => ({ description: '', amount: '', accountId: '' });

/** Landed costs (تكاليف الاستيراد): freight, customs... spread over the goods received on purchase orders. */
export default function LandedCostsPage() {
  const t = useTranslations('ops');
  const name = useNamer();
  const { data: rows = [], isLoading } = useOpsQuery(['landed-costs'], opsPurchasing.landedCosts);
  const { data: orders = [] } = useOpsQuery(['purchase-orders'], opsPurchasing.orders);
  const { data: suppliers = [] } = useOpsSuppliers();
  const orderMap = byId(orders);
  const supMap = byId(suppliers);
  const create = useModal();
  const detail = useModal<Row>();

  const post = useOpsMutation((id: string) => opsPurchasing.postLandedCost(id), { invalidate: ['landed-costs'], success: 'posted', onSuccess: () => detail.close() });
  const cancel = useOpsMutation((id: string) => opsPurchasing.cancelLandedCost(id), { invalidate: ['landed-costs'], success: 'cancelled', onSuccess: () => detail.close() });

  const poNumbers = (r: Row) => (r.purchaseOrderIds ?? []).map((id: string) => orderMap[id]?.orderNumber ?? '…').join('، ');

  return (
    <div>
      <PageHeader title={t('pur.landedCosts')} action={{ label: t('pur.newLandedCost'), onClick: () => create.open() }} />
      <p className="text-sm text-gray-500 -mt-4 mb-4">{t('pur.landedCostsIntro')}</p>
      <DataTable
        data={rows}
        loading={isLoading}
        searchable
        pageSize={20}
        onRowClick={(r: Row) => detail.open(r)}
        columns={[
          { key: 'number', header: t('common.number') },
          { key: 'date', header: t('common.date'), render: (r: Row) => fmtDate(r.date) },
          { key: 'purchaseOrderIds', header: t('pur.purchaseOrders'), render: poNumbers },
          { key: 'splitMethod', header: t('pur.splitMethod'), render: (r: Row) => t(`pur.split.${r.splitMethod}`) },
          { key: 'totalAmount', header: t('common.total'), render: (r: Row) => fmtMoney(r.totalAmount) },
          { key: 'status', header: t('common.status'), render: (r: Row) => <Status status={r.status} /> },
        ]}
        actions={(r: Row) => (
          <RowActions>
            <RowAction onClick={() => detail.open(r)}>{t('common.view')}</RowAction>
            {r.status === 'draft' && (
              <RowAction tone="green" disabled={post.isPending} onClick={() => post.mutate(r.id)}>
                {t('common.postNow')}
              </RowAction>
            )}
            {r.status !== 'cancelled' && (
              <RowAction tone="red" disabled={cancel.isPending} onClick={() => cancel.mutate(r.id)}>
                {t('common.cancel')}
              </RowAction>
            )}
          </RowActions>
        )}
      />
      {create.isOpen && <CreateLandedCostModal orders={orders} supMap={supMap} onClose={create.close} onCreated={(r) => detail.open(r)} />}
      {detail.data && (
        <LandedCostDetail
          id={detail.data.id}
          poNumbers={poNumbers}
          onClose={detail.close}
          onPost={(id) => post.mutate(id)}
          onCancel={(id) => cancel.mutate(id)}
          busy={post.isPending || cancel.isPending}
          name={name}
        />
      )}
    </div>
  );
}

function CreateLandedCostModal({
  orders,
  supMap,
  onClose,
  onCreated,
}: {
  orders: Row[];
  supMap: Record<string, Row>;
  onClose: () => void;
  onCreated: (r: Row) => void;
}) {
  const t = useTranslations('ops');
  const name = useNamer();
  const [date, setDate] = useState(today());
  const [splitMethod, setSplitMethod] = useState<Split>('by_value');
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [charges, setCharges] = useState<ChargeDraft[]>([emptyCharge()]);
  const [notes, setNotes] = useState('');
  // Only orders that received goods can carry landed costs.
  const eligible = orders.filter(
    (o) => ['confirmed', 'received', 'done'].includes(o.status) && (o.lines ?? []).some((l: any) => num(l.qtyReceived) > 0),
  );
  const shown = eligible.filter((o) => {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return String(o.orderNumber).toLowerCase().includes(q) || name(o.supplier ?? supMap[o.supplierId]).toLowerCase().includes(q);
  });
  const setCharge = (i: number, patch: Partial<ChargeDraft>) => setCharges((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  const total = charges.reduce((s, c) => s + num(c.amount), 0);
  const valid = date && selected.length > 0 && charges.length > 0 && charges.every((c) => c.description.trim() && num(c.amount) > 0);

  const save = useOpsMutation(
    () =>
      opsPurchasing.createLandedCost({
        date,
        purchaseOrderIds: selected,
        splitMethod,
        charges: charges.map((c) => ({ description: c.description.trim(), amount: num(c.amount), accountId: c.accountId || undefined })),
        notes: notes || undefined,
      }),
    {
      invalidate: ['landed-costs'],
      onSuccess: (r: Row) => {
        onClose();
        onCreated(r);
      },
    },
  );

  return (
    <Modal isOpen onClose={onClose} title={t('pur.newLandedCost')} size="xl">
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label={t('common.date')} required>
            <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={t('pur.splitMethod')} required>
            <SelectBox
              value={splitMethod}
              onChange={(v) => setSplitMethod(v as Split)}
              emptyLabel={false}
              options={(['by_value', 'by_quantity', 'equal'] as Split[]).map((s) => ({ value: s, label: t(`pur.split.${s}`) }))}
            />
          </Field>
          <Field label={t('common.notes')}>
            <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>

        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <span className="text-sm font-semibold">
              {t('pur.purchaseOrders')} ({selected.length})
            </span>
            <input className={`${inputCls} max-w-xs`} placeholder={t('common.search')} value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          {eligible.length === 0 ? (
            <p className="text-sm text-amber-700 bg-amber-50 rounded-lg p-3">{t('pur.noReceivedOrders')}</p>
          ) : (
            <div className="max-h-56 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
              {shown.map((o) => (
                <label key={o.id} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.includes(o.id)}
                    onChange={(e) => setSelected((s) => (e.target.checked ? [...s, o.id] : s.filter((x) => x !== o.id)))}
                  />
                  <span className="font-medium">{o.orderNumber}</span>
                  <span className="text-gray-600">{name(o.supplier ?? supMap[o.supplierId])}</span>
                  <span className="text-gray-500">{fmtDate(o.date)}</span>
                  <span className="ms-auto tabular-nums">{fmtMoney(o.totalAmount)}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div>
          <span className="text-sm font-semibold">{t('pur.charges')}</span>
          <table className="w-full text-sm mt-2">
            <thead>
              <tr className="bg-gray-50">
                <th className="text-start px-2 py-2">{t('common.description')}</th>
                <th className="text-start px-2 py-2 w-36">{t('common.amount')}</th>
                <th className="text-start px-2 py-2 w-[38%]">{t('pur.chargeAccount')}</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {charges.map((c, i) => (
                <tr key={i} className="border-b border-gray-100">
                  <td className="px-2 py-1.5">
                    <input className={inputCls} value={c.description} placeholder={t('pur.chargePlaceholder')} onChange={(e) => setCharge(i, { description: e.target.value })} />
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="number" step="any" min="0" className={inputCls} value={c.amount} onChange={(e) => setCharge(i, { amount: e.target.value })} />
                  </td>
                  <td className="px-2 py-1.5">
                    <AccountPicker value={c.accountId} onChange={(id) => setCharge(i, { accountId: id })} />
                  </td>
                  <td className="px-2 py-1.5">
                    <button
                      type="button"
                      disabled={charges.length <= 1}
                      onClick={() => setCharges((cs) => cs.filter((_, idx) => idx !== i))}
                      className="p-1 text-gray-400 hover:text-red-600 disabled:opacity-30"
                      aria-label={t('common.remove')}
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
                  <button type="button" className="inline-flex items-center gap-1 text-primary-600 text-sm" onClick={() => setCharges((cs) => [...cs, emptyCharge()])}>
                    <Plus size={14} /> {t('pur.addCharge')}
                  </button>
                </td>
                <td className="px-2 py-2 tabular-nums">{fmtMoney(total)}</td>
                <td colSpan={2} className="px-2 py-2 text-xs font-normal text-gray-500">
                  {t('pur.chargeAccountHint')}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="text-xs text-gray-500">{t('pur.landedCostDraftHint')}</p>
        <div className="flex justify-end gap-2">
          <Btn variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Btn>
          <Btn disabled={!valid} loading={save.isPending} onClick={() => save.mutate(undefined)}>
            {t('common.save')}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

function LandedCostDetail({
  id,
  poNumbers,
  onClose,
  onPost,
  onCancel,
  busy,
  name,
}: {
  id: string;
  poNumbers: (r: Row) => string;
  onClose: () => void;
  onPost: (id: string) => void;
  onCancel: (id: string) => void;
  busy: boolean;
  name: (r: any) => string;
}) {
  const t = useTranslations('ops');
  const accountLabel = useAccountLabel();
  const { data: products = [] } = useOpsProducts();
  const productMap = byId(products);
  const doc = useOpsQuery(['landed-costs', id], () => opsPurchasing.landedCost(id));
  const isDraft = doc.data?.status === 'draft';
  const preview = useOpsQuery(['landed-costs', id, 'preview'], () => opsPurchasing.landedCostPreview(id), { enabled: isDraft });
  const d = doc.data;
  const allocations: any[] = (isDraft ? preview.data?.allocations : d?.allocations) ?? [];
  const allocTotal = allocations.reduce((s, a) => s + num(a.amount), 0);

  return (
    <Modal isOpen onClose={onClose} title={`${t('pur.landedCost')} ${d?.number ?? ''}`} size="xl">
      {!d ? (
        <p className="text-sm text-gray-500">{t('common.loading')}</p>
      ) : (
        <div className="space-y-4">
          <DetailGrid
            items={[
              { label: t('common.date'), value: fmtDate(d.date) },
              { label: t('common.status'), value: <Status status={d.status} /> },
              { label: t('pur.splitMethod'), value: t(`pur.split.${d.splitMethod}`) },
              { label: t('common.total'), value: fmtMoney(d.totalAmount) },
              { label: t('pur.purchaseOrders'), value: poNumbers(d) },
              { label: t('common.notes'), value: d.notes || '-' },
            ]}
          />
          <SimpleTable
            rows={(d.charges ?? []).map((c: any, i: number) => ({ ...c, id: String(i) }))}
            columns={[
              { key: 'description', header: t('pur.charges') },
              { key: 'amount', header: t('common.amount'), render: (c) => fmtMoney(c.amount) },
              { key: 'accountId', header: t('pur.chargeAccount'), render: (c) => (c.accountId ? accountLabel(c.accountId) : t('pur.defaultPurchaseAccount')) },
            ]}
          />
          <div>
            <h3 className="text-sm font-semibold mb-2">{isDraft ? t('pur.splitPreview') : t('pur.allocation')}</h3>
            {isDraft && preview.isLoading ? (
              <p className="text-sm text-gray-500">{t('common.loading')}</p>
            ) : (
              <SimpleTable
                rows={allocations.map((a, i) => ({ ...a, id: a.productId ?? String(i) }))}
                columns={[
                  { key: 'productId', header: t('common.product'), render: (a) => (productMap[a.productId] ? name(productMap[a.productId]) : a.productId) },
                  { key: 'receivedQty', header: t('pur.receivedQty'), render: (a) => fmtQty(a.receivedQty) },
                  { key: 'receivedValue', header: t('pur.receivedValue'), render: (a) => fmtMoney(a.receivedValue) },
                  { key: 'share', header: t('pur.share'), render: (a) => `${(num(a.share) * (num(a.share) <= 1 ? 100 : 1)).toFixed(2)}%` },
                  { key: 'amount', header: t('common.amount'), render: (a) => fmtMoney(a.amount) },
                  { key: 'inventoryAmount', header: t('pur.toInventory'), render: (a) => fmtMoney(a.inventoryAmount) },
                  { key: 'cogsAmount', header: t('pur.toCogs'), render: (a) => fmtMoney(a.cogsAmount) },
                ]}
                footer={
                  <tfoot>
                    <tr className="bg-gray-50 font-semibold">
                      <td className="px-3 py-2" colSpan={4}>
                        {t('common.total')}
                      </td>
                      <td className="px-3 py-2">{fmtMoney(allocTotal)}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                }
              />
            )}
            <p className="text-xs text-gray-500 mt-2">{t('pur.cogsHint')}</p>
          </div>
          <div className="flex justify-end gap-2">
            {d.status !== 'cancelled' && (
              <Btn variant="danger" disabled={busy} onClick={() => onCancel(d.id)}>
                {t('common.cancel')}
              </Btn>
            )}
            {isDraft && (
              <Btn variant="success" disabled={busy || !allocations.length} onClick={() => onPost(d.id)}>
                {t('common.postNow')}
              </Btn>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
