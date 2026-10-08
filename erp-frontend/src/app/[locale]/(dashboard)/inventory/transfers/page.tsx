'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { Btn, Field, inputCls, inputSm, SelectBox, toOptions } from '@/components/operations/form';
import {
  byId, DetailGrid, FilterBar, fmtDate, fmtMoney, fmtQty, num, RowAction, RowActions, SimpleTable, Status, today, useModal, useNamer,
} from '@/components/operations/common';
import LotsInput, { type LotDraft, lotsPayload } from '@/components/operations/LotsInput';
import { useOpsMutation, useOpsProducts, useOpsQuery, useOpsWarehouses } from '@/hooks/use-operations';
import { opsInventory } from '@/services/operations-inventory.service';
import type { Row } from '@/services/operations-api';

const STATUSES = ['draft', 'in_transit', 'done', 'cancelled'];

export default function TransfersPage() {
  const t = useTranslations('ops');
  const name = useNamer();
  const [status, setStatus] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const { data: warehouses = [] } = useOpsWarehouses();
  const whMap = byId(warehouses);
  const { data: transfers = [], isLoading } = useOpsQuery(['transfers', status, warehouseId], () =>
    opsInventory.transfers({ status, warehouseId }),
  );
  const create = useModal();
  const detail = useModal<Row>();
  const receive = useModal<Row>();

  const inv = ['transfers', 'stock-balance', 'lots'];
  const ship = useOpsMutation((id: string) => opsInventory.shipTransfer(id), { invalidate: inv, success: 'shipped' });
  const validate = useOpsMutation((id: string) => opsInventory.validateTransfer(id), { invalidate: inv, success: 'validated' });
  const cancel = useOpsMutation((id: string) => opsInventory.cancelTransfer(id), { invalidate: inv, success: 'cancelled' });

  return (
    <div>
      <PageHeader title={t('inv.transfers')} action={{ label: t('inv.newTransfer'), onClick: () => create.open() }} />
      <FilterBar>
        <Field label={t('common.status')}>
          <SelectBox value={status} onChange={setStatus} emptyLabel={t('common.all')} options={STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) }))} />
        </Field>
        <Field label={t('common.warehouse')}>
          <SelectBox value={warehouseId} onChange={setWarehouseId} emptyLabel={t('common.all')} options={toOptions(warehouses, name)} />
        </Field>
      </FilterBar>
      <DataTable
        data={transfers}
        loading={isLoading}
        searchable
        onRowClick={(r: Row) => detail.open(r)}
        columns={[
          { key: 'transferNumber', header: t('common.number') },
          { key: 'date', header: t('common.date'), render: (r: Row) => fmtDate(r.date) },
          { key: 'fromWarehouseId', header: t('inv.fromWarehouse'), render: (r: Row) => name(r.fromWarehouse ?? whMap[r.fromWarehouseId]) },
          { key: 'toWarehouseId', header: t('inv.toWarehouse'), render: (r: Row) => name(r.toWarehouse ?? whMap[r.toWarehouseId]) },
          { key: 'lines', header: t('common.lines'), render: (r: Row) => r.lines?.length ?? 0 },
          { key: 'inTransitValue', header: t('inv.inTransitValue'), render: (r: Row) => fmtMoney(r.inTransitValue) },
          { key: 'status', header: t('common.status'), render: (r: Row) => <Status status={r.status} /> },
        ]}
        actions={(r: Row) => (
          <RowActions>
            {r.status === 'draft' && (
              <>
                <RowAction onClick={() => ship.mutate(r.id)} disabled={ship.isPending}>{t('inv.ship')}</RowAction>
                <RowAction tone="green" onClick={() => validate.mutate(r.id)} disabled={validate.isPending}>{t('inv.validateDirect')}</RowAction>
              </>
            )}
            {r.status === 'in_transit' && (
              <RowAction tone="green" onClick={() => receive.open(r)}>{t('inv.receive')}</RowAction>
            )}
            {['draft', 'in_transit'].includes(r.status) && (
              <RowAction tone="red" onClick={() => cancel.mutate(r.id)} disabled={cancel.isPending}>{t('common.cancel')}</RowAction>
            )}
          </RowActions>
        )}
      />

      {create.isOpen && <CreateTransferModal warehouses={warehouses} onClose={create.close} />}
      {receive.data && <ReceiveTransferModal transfer={receive.data} onClose={receive.close} />}
      {detail.data && (
        <Modal isOpen onClose={detail.close} title={`${t('inv.transfer')} ${detail.data.transferNumber}`} size="xl">
          <DetailGrid
            items={[
              { label: t('common.date'), value: fmtDate(detail.data.date) },
              { label: t('inv.fromWarehouse'), value: name(detail.data.fromWarehouse ?? whMap[detail.data.fromWarehouseId]) },
              { label: t('inv.toWarehouse'), value: name(detail.data.toWarehouse ?? whMap[detail.data.toWarehouseId]) },
              { label: t('common.status'), value: <Status status={detail.data.status} /> },
              { label: t('inv.shippedAt'), value: fmtDate(detail.data.shippedAt) },
              { label: t('inv.receivedAt'), value: fmtDate(detail.data.receivedAt) },
              { label: t('common.notes'), value: detail.data.notes || '-' },
            ]}
          />
          <div className="mt-4">
            <SimpleTable
              rows={detail.data.lines ?? []}
              columns={[
                { key: 'product', header: t('common.product'), render: (l) => name(l.product) },
                { key: 'quantity', header: t('common.quantity'), render: (l) => fmtQty(l.quantity) },
                { key: 'qtyShipped', header: t('inv.shipped'), render: (l) => fmtQty(l.qtyShipped) },
                { key: 'qtyReceived', header: t('inv.received'), render: (l) => fmtQty(l.qtyReceived) },
                {
                  key: 'lots',
                  header: t('inv.lots'),
                  render: (l) =>
                    [...(l.shippedLots?.length ? l.shippedLots : l.requestedLots ?? [])]
                      .map((x: any) => `${x.lotNumber} (${fmtQty(x.quantity)})`)
                      .join(', ') || '-',
                },
              ]}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}

interface TLine {
  productId: string;
  quantity: string;
  lots: LotDraft[];
}

function CreateTransferModal({ warehouses, onClose }: { warehouses: Row[]; onClose: () => void }) {
  const t = useTranslations('ops');
  const name = useNamer();
  const { data: products = [] } = useOpsProducts();
  const productMap = byId(products);
  const [fromWarehouseId, setFrom] = useState(warehouses[0]?.id ?? '');
  const [toWarehouseId, setTo] = useState(warehouses[1]?.id ?? '');
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [direct, setDirect] = useState(false);
  const [lines, setLines] = useState<TLine[]>([{ productId: '', quantity: '1', lots: [] }]);

  const save = useOpsMutation(
    () =>
      opsInventory.createTransfer({
        fromWarehouseId,
        toWarehouseId,
        date,
        notes: notes || undefined,
        direct,
        lines: lines
          .filter((l) => l.productId && num(l.quantity) > 0)
          .map((l) => {
            const lots = lotsPayload(l.lots);
            return { productId: l.productId, quantity: num(l.quantity), ...(lots.length ? { lots } : {}) };
          }),
      }),
    { invalidate: ['transfers', 'stock-balance'], onSuccess: onClose },
  );

  const setLine = (i: number, patch: Partial<TLine>) => setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const goods = products.filter((p) => p.type !== 'service');

  return (
    <Modal isOpen onClose={onClose} title={t('inv.newTransfer')} size="xl">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label={t('inv.fromWarehouse')} required>
            <SelectBox value={fromWarehouseId} onChange={setFrom} required options={toOptions(warehouses, name)} />
          </Field>
          <Field label={t('inv.toWarehouse')} required>
            <SelectBox value={toWarehouseId} onChange={setTo} required options={toOptions(warehouses.filter((w) => w.id !== fromWarehouseId), name)} />
          </Field>
          <Field label={t('common.date')}>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </Field>
          <Field label={t('common.notes')} className="md:col-span-2">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
          </Field>
          <label className="flex items-center gap-2 text-sm pt-6">
            <input type="checkbox" checked={direct} onChange={(e) => setDirect(e.target.checked)} />
            {t('inv.directTransfer')}
          </label>
        </div>
        <div className="space-y-3">
          {lines.map((l, i) => {
            const p = productMap[l.productId];
            const tracked = p && p.trackingType && p.trackingType !== 'none';
            return (
              <div key={i} className="border border-gray-200 rounded-lg p-3 space-y-2">
                <div className="flex gap-2 items-end">
                  <Field label={t('common.product')} className="flex-1">
                    <SelectBox value={l.productId} onChange={(v) => setLine(i, { productId: v, lots: [] })} options={toOptions(goods, name)} />
                  </Field>
                  <Field label={t('common.quantity')} className="w-32">
                    <input type="number" step="any" min="0" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} className={inputCls} />
                  </Field>
                  <button type="button" onClick={() => setLines(lines.filter((_, idx) => idx !== i))} className="p-2 text-red-500" aria-label={t('common.remove')}>
                    <Trash2 size={16} />
                  </button>
                </div>
                {tracked && (
                  <Field label={t('inv.lotsOptional')}>
                    <LotsInput lots={l.lots} onChange={(lots) => setLine(i, { lots })} showExpiry={false} />
                  </Field>
                )}
              </div>
            );
          })}
          <button type="button" onClick={() => setLines([...lines, { productId: '', quantity: '1', lots: [] }])} className="inline-flex items-center gap-1 text-sm text-primary-600 hover:underline">
            <Plus size={16} /> {t('common.addLine')}
          </button>
        </div>
        <div className="flex justify-end gap-2">
          <Btn variant="secondary" onClick={onClose}>{t('common.cancel')}</Btn>
          <Btn type="submit" loading={save.isPending}>{t('common.save')}</Btn>
        </div>
      </form>
    </Modal>
  );
}

function ReceiveTransferModal({ transfer, onClose }: { transfer: Row; onClose: () => void }) {
  const t = useTranslations('ops');
  const name = useNamer();
  const [date, setDate] = useState(today());
  const [qty, setQty] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    (transfer.lines ?? []).forEach((l: any) => (init[l.id] = String(num(l.qtyShipped) - num(l.qtyReceived))));
    return init;
  });
  const save = useOpsMutation(
    () =>
      opsInventory.receiveTransfer(transfer.id, {
        date,
        lines: (transfer.lines ?? []).map((l: any) => ({ lineId: l.id, quantity: num(qty[l.id]) })),
      }),
    { invalidate: ['transfers', 'stock-balance', 'lots'], success: 'received', onSuccess: onClose },
  );
  return (
    <Modal isOpen onClose={onClose} title={`${t('inv.receive')} ${transfer.transferNumber}`} size="lg">
      <div className="space-y-4">
        <Field label={t('common.date')}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
        </Field>
        <SimpleTable
          rows={transfer.lines ?? []}
          columns={[
            { key: 'product', header: t('common.product'), render: (l) => name(l.product) },
            { key: 'qtyShipped', header: t('inv.shipped'), render: (l) => fmtQty(l.qtyShipped) },
            { key: 'qtyReceived', header: t('inv.received'), render: (l) => fmtQty(l.qtyReceived) },
            {
              key: 'now',
              header: t('inv.receiveNow'),
              render: (l) => (
                <input type="number" step="any" min="0" value={qty[l.id] ?? ''} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} className={`${inputSm} w-28`} />
              ),
            },
          ]}
        />
        <div className="flex justify-end gap-2">
          <Btn variant="secondary" onClick={onClose}>{t('common.cancel')}</Btn>
          <Btn variant="success" loading={save.isPending} onClick={() => save.mutate(undefined)}>{t('inv.receive')}</Btn>
        </div>
      </div>
    </Modal>
  );
}
