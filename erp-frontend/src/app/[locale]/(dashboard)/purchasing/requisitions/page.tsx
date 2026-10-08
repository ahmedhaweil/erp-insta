'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { EntityForm, Field, inputCls, SelectBox, toOptions, type FieldDef } from '@/components/operations/form';
import {
  byId, DetailGrid, FilterBar, fmtDate, fmtMoney, fmtQty, num, PromptModal, RowAction, RowActions, SimpleTable, Status, today, useModal, useNamer,
} from '@/components/operations/common';
import { useOpsMutation, useOpsProducts, useOpsQuery, useOpsSuppliers, useOpsWarehouses } from '@/hooks/use-operations';
import { opsPurchasing } from '@/services/operations-purchasing.service';
import type { Row } from '@/services/operations-api';

const STATUSES = ['draft', 'submitted', 'approved', 'rejected', 'converted', 'cancelled'];

/** Internal purchase requisitions: submit, approve / reject, convert to RFQs. */
export default function RequisitionsPage() {
  const t = useTranslations('ops');
  const name = useNamer();
  const [status, setStatus] = useState('');
  const { data: reqs = [], isLoading } = useOpsQuery(['requisitions', status], () => opsPurchasing.requisitions(status || undefined));
  const { data: products = [] } = useOpsProducts();
  const { data: suppliers = [] } = useOpsSuppliers();
  const productMap = byId(products);
  const supMap = byId(suppliers);
  const create = useModal();
  const detail = useModal<Row>();
  const reject = useModal<Row>();
  const convert = useModal<Row>();

  const inv = ['requisitions', 'purchase-orders'];
  const submit = useOpsMutation((id: string) => opsPurchasing.submitRequisition(id), { invalidate: inv, success: 'submitted' });
  const approve = useOpsMutation((id: string) => opsPurchasing.approveRequisition(id), { invalidate: inv, success: 'approved' });
  const doReject = useOpsMutation((a: { id: string; reason: string }) => opsPurchasing.rejectRequisition(a.id, a.reason), {
    invalidate: inv,
    success: 'rejected',
    onSuccess: () => reject.close(),
  });
  const cancel = useOpsMutation((id: string) => opsPurchasing.cancelRequisition(id), { invalidate: inv, success: 'cancelled' });
  const doConvert = useOpsMutation((a: { id: string; body: any }) => opsPurchasing.convertRequisition(a.id, a.body), {
    invalidate: inv,
    success: 'converted',
    onSuccess: () => convert.close(),
  });

  return (
    <div>
      <PageHeader title={t('pur.requisitions')} action={{ label: t('pur.newRequisition'), onClick: () => create.open() }} />
      <FilterBar>
        <Field label={t('common.status')}>
          <SelectBox value={status} onChange={setStatus} emptyLabel={t('common.all')} options={STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) }))} />
        </Field>
      </FilterBar>
      <DataTable
        data={reqs}
        loading={isLoading}
        searchable
        onRowClick={(r: Row) => detail.open(r)}
        columns={[
          { key: 'requisitionNumber', header: t('common.number') },
          { key: 'date', header: t('common.date'), render: (r: Row) => fmtDate(r.date) },
          { key: 'departmentName', header: t('pur.department') },
          { key: 'requiredDate', header: t('pur.requiredDate'), render: (r: Row) => fmtDate(r.requiredDate) },
          { key: 'lines', header: t('common.lines'), render: (r: Row) => r.lines?.length ?? 0 },
          { key: 'status', header: t('common.status'), render: (r: Row) => <Status status={r.status} /> },
        ]}
        actions={(r: Row) => (
          <RowActions>
            {r.status === 'draft' && <RowAction onClick={() => submit.mutate(r.id)}>{t('pur.submit')}</RowAction>}
            {r.status === 'submitted' && (
              <>
                <RowAction tone="green" onClick={() => approve.mutate(r.id)}>{t('pur.approve')}</RowAction>
                <RowAction tone="red" onClick={() => reject.open(r)}>{t('pur.reject')}</RowAction>
              </>
            )}
            {r.status === 'approved' && <RowAction tone="amber" onClick={() => convert.open(r)}>{t('pur.convertToRfq')}</RowAction>}
            {['draft', 'submitted', 'approved'].includes(r.status) && (
              <RowAction tone="red" onClick={() => cancel.mutate(r.id)}>{t('common.cancel')}</RowAction>
            )}
          </RowActions>
        )}
      />
      {create.isOpen && <CreateRequisitionModal onClose={create.close} />}
      {detail.data && (
        <Modal isOpen onClose={detail.close} title={`${t('pur.requisition')} ${detail.data.requisitionNumber}`} size="xl">
          <DetailGrid
            items={[
              { label: t('pur.department'), value: detail.data.departmentName || '-' },
              { label: t('common.date'), value: fmtDate(detail.data.date) },
              { label: t('pur.requiredDate'), value: fmtDate(detail.data.requiredDate) },
              { label: t('common.status'), value: <Status status={detail.data.status} /> },
              { label: t('pur.rejectionReason'), value: detail.data.rejectionReason || '-' },
              { label: t('common.notes'), value: detail.data.notes || '-' },
            ]}
          />
          <div className="mt-4">
            <SimpleTable
              rows={detail.data.lines ?? []}
              columns={[
                { key: 'product', header: t('common.product'), render: (l) => name(l.product ?? productMap[l.productId]) },
                { key: 'quantity', header: t('common.quantity'), render: (l) => fmtQty(l.quantity) },
                { key: 'estimatedPrice', header: t('pur.estimatedPrice'), render: (l) => (l.estimatedPrice != null ? fmtMoney(l.estimatedPrice) : '-') },
                { key: 'supplierId', header: t('common.supplier'), render: (l) => (l.supplierId ? name(supMap[l.supplierId]) : '-') },
                { key: 'description', header: t('common.description'), render: (l) => l.description || '-' },
              ]}
            />
          </div>
        </Modal>
      )}
      <PromptModal
        isOpen={reject.isOpen}
        title={t('pur.reject')}
        label={t('common.reason')}
        required={false}
        loading={doReject.isPending}
        onClose={reject.close}
        onSubmit={(reason) => reject.data && doReject.mutate({ id: reject.data.id, reason })}
      />
      {convert.data && (
        <Modal isOpen onClose={convert.close} title={`${t('pur.convertToRfq')} - ${convert.data.requisitionNumber}`}>
          <p className="text-sm text-gray-600 mb-3">{t('pur.convertHint')}</p>
          <EntityForm
            fields={[
              { name: 'supplierId', label: t('pur.defaultSupplier'), type: 'select', options: toOptions(suppliers, name) },
              { name: 'date', label: t('common.date'), type: 'date' },
            ]}
            initial={{ date: today() }}
            loading={doConvert.isPending}
            onCancel={convert.close}
            onSubmit={(p) => doConvert.mutate({ id: convert.data!.id, body: p })}
          />
        </Modal>
      )}
    </div>
  );
}

interface RLine {
  productId: string;
  quantity: string;
  estimatedPrice: string;
  supplierId: string;
  description: string;
}

function CreateRequisitionModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations('ops');
  const name = useNamer();
  const { data: products = [] } = useOpsProducts();
  const { data: suppliers = [] } = useOpsSuppliers();
  const { data: warehouses = [] } = useOpsWarehouses();
  const blank: RLine = { productId: '', quantity: '1', estimatedPrice: '', supplierId: '', description: '' };
  const [lines, setLines] = useState<RLine[]>([blank]);
  const save = useOpsMutation((body: any) => opsPurchasing.createRequisition(body), { invalidate: ['requisitions'], onSuccess: onClose });
  const setLine = (i: number, patch: Partial<RLine>) => setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const fields: FieldDef[] = [
    { name: 'departmentName', label: t('pur.department') },
    { name: 'date', label: t('common.date'), type: 'date' },
    { name: 'requiredDate', label: t('pur.requiredDate'), type: 'date' },
    { name: 'warehouseId', label: t('common.warehouse'), type: 'select', options: toOptions(warehouses, name) },
    { name: 'notes', label: t('common.notes'), wide: true },
  ];
  return (
    <Modal isOpen onClose={onClose} title={t('pur.newRequisition')} size="xl">
      <EntityForm
        fields={fields}
        columns={3}
        initial={{ date: today() }}
        loading={save.isPending}
        onCancel={onClose}
        onSubmit={(h) => {
          const l = lines
            .filter((x) => x.productId && num(x.quantity) > 0)
            .map((x) => ({
              productId: x.productId,
              quantity: num(x.quantity),
              estimatedPrice: x.estimatedPrice === '' ? undefined : num(x.estimatedPrice),
              supplierId: x.supplierId || undefined,
              description: x.description || undefined,
            }));
          if (l.length) save.mutate({ ...h, lines: l });
        }}
      >
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-2 md:grid-cols-12 gap-2 items-end">
              <Field label={t('common.product')} className="col-span-2 md:col-span-4">
                <SelectBox value={l.productId} onChange={(v) => setLine(i, { productId: v })} options={toOptions(products, name)} />
              </Field>
              <Field label={t('common.quantity')} className="md:col-span-2">
                <input type="number" step="any" min="0" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} className={inputCls} />
              </Field>
              <Field label={t('pur.estimatedPrice')} className="md:col-span-2">
                <input type="number" step="any" min="0" value={l.estimatedPrice} onChange={(e) => setLine(i, { estimatedPrice: e.target.value })} className={inputCls} />
              </Field>
              <Field label={t('common.supplier')} className="md:col-span-3">
                <SelectBox value={l.supplierId} onChange={(v) => setLine(i, { supplierId: v })} options={toOptions(suppliers, name)} />
              </Field>
              <button type="button" onClick={() => setLines(lines.filter((_, idx) => idx !== i))} className="p-2 text-red-500 md:col-span-1" aria-label={t('common.remove')}>
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setLines([...lines, blank])} className="inline-flex items-center gap-1 text-sm text-primary-600 hover:underline">
            <Plus size={16} /> {t('common.addLine')}
          </button>
        </div>
      </EntityForm>
    </Modal>
  );
}
