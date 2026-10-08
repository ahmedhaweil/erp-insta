'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import PageHeader from '@/components/ui/PageHeader';
import { Btn, Field, SelectBox, toOptions } from '@/components/operations/form';
import { byId, Card, FilterBar, fmtQty, SimpleTable, useNamer } from '@/components/operations/common';
import { useOpsMutation, useOpsQuery, useOpsSuppliers, useOpsWarehouses } from '@/hooks/use-operations';
import { opsPurchasing } from '@/services/operations-purchasing.service';

/** Reorder suggestions (on hand + incoming vs reorder level) and RFQ generation per preferred supplier. */
export default function ReplenishmentPage() {
  const t = useTranslations('ops');
  const name = useNamer();
  const { data: rows = [], isLoading } = useOpsQuery(['replenishment'], opsPurchasing.replenishment);
  const { data: suppliers = [] } = useOpsSuppliers();
  const { data: warehouses = [] } = useOpsWarehouses();
  const supMap = byId(suppliers);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [warehouseId, setWarehouseId] = useState('');
  const [created, setCreated] = useState<any[]>([]);
  const chosen = Object.keys(selected).filter((k) => selected[k]);

  const generate = useOpsMutation(
    () => opsPurchasing.generateRfqs({ warehouseId: warehouseId || undefined, productIds: chosen.length ? chosen : undefined }),
    {
      invalidate: ['replenishment', 'purchase-orders'],
      success: false,
      onSuccess: (r: any) => {
        const orders = r?.orders ?? [];
        setCreated(orders);
        setSelected({});
        toast.success(`${t('msg.generated')}: ${orders.length}`);
      },
    },
  );

  const allChecked = rows.length > 0 && rows.every((r) => selected[r.productId]);

  return (
    <div className="space-y-4">
      <PageHeader title={t('pur.replenishment')} />
      <p className="text-sm text-gray-600">{t('pur.replenishmentHint')}</p>
      <FilterBar>
        <Field label={t('pur.receivingWarehouse')}>
          <SelectBox value={warehouseId} onChange={setWarehouseId} emptyLabel={t('common.auto')} options={toOptions(warehouses, name)} />
        </Field>
        <Btn loading={generate.isPending} disabled={!rows.length} onClick={() => generate.mutate(undefined)}>
          {chosen.length ? `${t('pur.generateRfqs')} (${chosen.length})` : t('pur.generateAllRfqs')}
        </Btn>
      </FilterBar>
      {isLoading ? (
        <p className="text-sm text-gray-500">{t('common.loading')}</p>
      ) : (
        <SimpleTable
          rows={rows.map((r) => ({ ...r, id: r.productId }))}
          columns={[
            {
              key: 'sel',
              header: '',
              render: (r) => (
                <input type="checkbox" checked={!!selected[r.productId]} onChange={(e) => setSelected({ ...selected, [r.productId]: e.target.checked })} />
              ),
            },
            { key: 'productCode', header: t('common.code') },
            { key: 'productName', header: t('common.product') },
            { key: 'onHand', header: t('inv.onHand'), render: (r) => fmtQty(r.onHand) },
            { key: 'incoming', header: t('pur.incoming'), render: (r) => fmtQty(r.incoming) },
            { key: 'forecast', header: t('pur.forecast'), render: (r) => fmtQty(r.forecast) },
            { key: 'reorderLevel', header: t('inv.reorderLevel'), render: (r) => fmtQty(r.reorderLevel) },
            { key: 'suggestedQty', header: t('inv.suggestedQty'), render: (r) => <strong>{fmtQty(r.suggestedQty)}</strong> },
            { key: 'preferredSupplierId', header: t('inv.preferredSupplier'), render: (r) => (r.preferredSupplierId ? name(supMap[r.preferredSupplierId]) : <span className="text-amber-600">{t('pur.noSupplier')}</span>) },
          ]}
        />
      )}
      {rows.length > 0 && (
        <button type="button" className="text-sm text-primary-600 hover:underline" onClick={() => setSelected(allChecked ? {} : Object.fromEntries(rows.map((r) => [r.productId, true])))}>
          {allChecked ? t('common.clearAll') : t('common.fillAll')}
        </button>
      )}
      {created.length > 0 && (
        <Card title={t('pur.generatedRfqs')}>
          <ul className="text-sm list-disc ps-5">
            {created.map((o) => (
              <li key={o.id}>
                {o.orderNumber} - {name(supMap[o.supplierId])} ({o.lines?.length ?? 0})
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
