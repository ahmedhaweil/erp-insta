'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { EntityForm, inputCls, inputSm, toOptions, type FieldDef } from '@/components/operations/form';
import {
  byId, DetailGrid, fmtDate, fmtMoney, fmtQty, num, RowAction, RowActions, SimpleTable, Status, Tabs, today, useModal, useNamer,
} from '@/components/operations/common';
import LinesEditor, { type DocLine, linesPayload, newLine } from '@/components/operations/LinesEditor';
import { useOpsMutation, useOpsProducts, useOpsQuery, useOpsSuppliers, useOpsWarehouses } from '@/hooks/use-operations';
import { opsPurchasing } from '@/services/operations-purchasing.service';
import type { Row } from '@/services/operations-api';

/** Purchase returns (goods sent back to the supplier), against a bill or standalone. */
export default function PurchaseReturnsPage() {
  const t = useTranslations('ops');
  const name = useNamer();
  const { data: returns = [], isLoading } = useOpsQuery(['purchase-returns'], () => opsPurchasing.returns());
  const { data: suppliers = [] } = useOpsSuppliers();
  const { data: products = [] } = useOpsProducts();
  const supMap = byId(suppliers);
  const productMap = byId(products);
  const create = useModal<string | null>();
  const detail = useModal<Row>();

  useEffect(() => {
    const billId = new URLSearchParams(window.location.search).get('billId');
    if (billId) create.open(billId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const inv = ['purchase-returns', 'bills', 'suppliers', 'stock-balance'];
  const post = useOpsMutation((id: string) => opsPurchasing.postReturn(id), { invalidate: inv, success: 'posted' });
  const cancel = useOpsMutation((id: string) => opsPurchasing.cancelReturn(id), { invalidate: inv, success: 'cancelled' });

  return (
    <div>
      <PageHeader title={t('pur.returns')} action={{ label: t('sales.newReturn'), onClick: () => create.open(null) }} />
      <DataTable
        data={returns}
        loading={isLoading}
        searchable
        pageSize={20}
        onRowClick={(r: Row) => detail.open(r)}
        columns={[
          { key: 'returnNumber', header: t('common.number') },
          { key: 'date', header: t('common.date'), render: (r: Row) => fmtDate(r.date) },
          { key: 'supplierId', header: t('common.supplier'), render: (r: Row) => name(r.supplier ?? supMap[r.supplierId]) },
          { key: 'refundMethod', header: t('sales.refundMethod'), render: (r: Row) => t(`pur.refundMethods.${r.refundMethod}`) },
          { key: 'totalAmount', header: t('common.total'), render: (r: Row) => fmtMoney(r.totalAmount) },
          { key: 'status', header: t('common.status'), render: (r: Row) => <Status status={r.status} /> },
        ]}
        actions={(r: Row) => (
          <RowActions>
            {r.status === 'draft' && <RowAction tone="green" onClick={() => post.mutate(r.id)}>{t('sales.post')}</RowAction>}
            {r.status !== 'cancelled' && <RowAction tone="red" onClick={() => cancel.mutate(r.id)}>{t('common.cancel')}</RowAction>}
          </RowActions>
        )}
      />
      {create.isOpen && <CreatePurchaseReturnModal billId={create.data} onClose={create.close} />}
      {detail.data && (
        <Modal isOpen onClose={detail.close} title={`${t('sales.return')} ${detail.data.returnNumber}`} size="xl">
          <DetailGrid
            items={[
              { label: t('common.supplier'), value: name(detail.data.supplier ?? supMap[detail.data.supplierId]) },
              { label: t('common.date'), value: fmtDate(detail.data.date) },
              { label: t('common.status'), value: <Status status={detail.data.status} /> },
              { label: t('common.total'), value: fmtMoney(detail.data.totalAmount) },
              { label: t('common.reason'), value: detail.data.reason || '-' },
            ]}
          />
          <div className="mt-4">
            <SimpleTable
              rows={detail.data.lines ?? []}
              columns={[
                { key: 'product', header: t('common.product'), render: (l) => name(l.product ?? productMap[l.productId]) },
                { key: 'quantity', header: t('common.quantity'), render: (l) => fmtQty(l.quantity) },
                { key: 'unitPrice', header: t('common.unitPrice'), render: (l) => fmtMoney(l.unitPrice) },
                { key: 'lineTotal', header: t('common.lineTotal'), render: (l) => fmtMoney(l.lineTotal) },
              ]}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}

function CreatePurchaseReturnModal({ billId, onClose }: { billId: string | null; onClose: () => void }) {
  const t = useTranslations('ops');
  const name = useNamer();
  const [mode, setMode] = useState<'bill' | 'free'>('bill');
  const [selected, setSelected] = useState(billId ?? '');
  const { data: bills = [] } = useOpsQuery(['bills'], opsPurchasing.bills);
  const { data: suppliers = [] } = useOpsSuppliers();
  const { data: warehouses = [] } = useOpsWarehouses();
  const { data: products = [] } = useOpsProducts();
  const productMap = byId(products);
  const [lines, setLines] = useState<DocLine[]>([newLine()]);
  const [qty, setQty] = useState<Record<string, string>>({});
  const bill = bills.find((b) => b.id === selected);
  const eligible = bills.filter((b) => b.moveType !== 'refund' && !['draft', 'cancelled'].includes(b.status));
  const save = useOpsMutation((body: any) => opsPurchasing.createReturn(body), {
    invalidate: ['purchase-returns', 'bills', 'stock-balance'],
    onSuccess: onClose,
  });

  const header: FieldDef[] = [
    ...(mode === 'free' ? [{ name: 'supplierId', label: t('common.supplier'), type: 'select' as const, required: true, options: toOptions(suppliers, name) }] : []),
    { name: 'warehouseId', label: t('common.warehouse'), type: 'select', options: toOptions(warehouses, name), hint: t('pur.returnWarehouseHint') },
    { name: 'date', label: t('common.date'), type: 'date' },
    { name: 'refundMethod', label: t('sales.refundMethod'), type: 'select', required: true, options: ['credit', 'cash'].map((m) => ({ value: m, label: t(`pur.refundMethods.${m}`) })) },
    { name: 'reason', label: t('common.reason') },
    { name: 'post', label: t('common.postNow'), type: 'checkbox' },
  ];

  return (
    <Modal isOpen onClose={onClose} title={t('pur.newReturn')} size="xl">
      <Tabs
        value={mode}
        onChange={setMode}
        tabs={[
          { key: 'bill', label: t('pur.returnFromBill') },
          { key: 'free', label: t('pur.returnWithoutBill') },
        ]}
      />
      <EntityForm
        key={mode}
        fields={header}
        columns={3}
        initial={{ date: today(), refundMethod: 'credit', warehouseId: warehouses[0]?.id, post: true }}
        loading={save.isPending}
        onCancel={onClose}
        onSubmit={(h) => {
          if (mode === 'bill') {
            if (!bill) return;
            const l = (bill.lines ?? []).map((x: any) => ({ invoiceLineId: x.id, quantity: num(qty[x.id]) })).filter((x: any) => x.quantity > 0);
            if (l.length) save.mutate({ ...h, originalBillId: bill.id, lines: l });
          } else {
            const l = linesPayload(lines, { requirePrice: true });
            if (l.length) save.mutate({ ...h, lines: l });
          }
        }}
      >
        {mode === 'bill' ? (
          <div className="space-y-3">
            <select value={selected} onChange={(e) => { setSelected(e.target.value); setQty({}); }} className={inputCls} required>
              <option value="">{t('pur.selectBill')}</option>
              {eligible.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.invoiceNumber} - {name(b.supplier)} - {fmtMoney(b.totalAmount)}
                </option>
              ))}
            </select>
            {bill && (
              <SimpleTable
                rows={bill.lines ?? []}
                columns={[
                  { key: 'product', header: t('common.product'), render: (l) => name(l.product ?? productMap[l.productId]) },
                  { key: 'quantity', header: t('pur.billed'), render: (l) => fmtQty(l.quantity) },
                  { key: 'qtyReturned', header: t('sales.returned'), render: (l) => fmtQty(l.qtyReturned) },
                  { key: 'unitPrice', header: t('common.unitPrice'), render: (l) => fmtMoney(l.unitPrice) },
                  {
                    key: 'ret',
                    header: t('sales.returnQty'),
                    render: (l) => (
                      <input type="number" step="any" min="0" max={num(l.quantity) - num(l.qtyReturned)} value={qty[l.id] ?? ''} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} className={`${inputSm} w-28`} />
                    ),
                  },
                ]}
              />
            )}
          </div>
        ) : (
          <LinesEditor lines={lines} onChange={setLines} products={products} priceField="costPrice" taxField="purchaseTaxRate" />
        )}
      </EntityForm>
    </Modal>
  );
}
