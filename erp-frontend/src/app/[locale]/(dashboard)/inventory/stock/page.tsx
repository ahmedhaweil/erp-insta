'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { useStock, useAdjustStock, useTransferStock } from '@/hooks/use-products';
import type { Stock } from '@/types';

interface AdjustFormData {
  productId: string;
  warehouseId: string;
  quantity: number;
  reason: string;
}

interface TransferFormData {
  productId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  quantity: number;
}

export default function StockPage() {
  const t = useTranslations('inventory');
  const tc = useTranslations('common');
  const [showAdjust, setShowAdjust] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);

  const { data: stock = [], isLoading } = useStock();
  const adjustStock = useAdjustStock();
  const transferStock = useTransferStock();

  const adjustForm = useForm<AdjustFormData>({
    defaultValues: { productId: '', warehouseId: '', quantity: 0, reason: '' },
  });

  const transferForm = useForm<TransferFormData>({
    defaultValues: { productId: '', fromWarehouseId: '', toWarehouseId: '', quantity: 0 },
  });

  const onAdjust = (data: AdjustFormData) => {
    adjustStock.mutate(data, {
      onSuccess: () => {
        setShowAdjust(false);
        adjustForm.reset();
      },
    });
  };

  const onTransfer = (data: TransferFormData) => {
    transferStock.mutate(data, {
      onSuccess: () => {
        setShowTransfer(false);
        transferForm.reset();
      },
    });
  };

  const columns = [
    { key: 'productId', header: t('productName') },
    { key: 'warehouseId', header: t('warehouses') },
    { key: 'quantity', header: t('currentStock'), render: (item: Stock) => Number(item.quantity).toFixed(2) },
    { key: 'reservedQty', header: t('reserved'), render: (item: Stock) => Number(item.reservedQty).toFixed(2) },
    {
      key: 'available', header: t('available'),
      render: (item: Stock) => (Number(item.quantity) - Number(item.reservedQty)).toFixed(2),
    },
  ];

  return (
    <div>
      <PageHeader title={t('stockLevels')} />
      <div className="flex gap-3 mb-4">
        <button onClick={() => setShowAdjust(true)} className="px-4 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 text-sm">{t('adjustStock')}</button>
        <button onClick={() => setShowTransfer(true)} className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm">{t('transferStock')}</button>
      </div>
      <DataTable columns={columns} data={stock.map((s, i) => ({ ...s, id: `${s.productId}-${s.warehouseId}` }))} loading={isLoading} searchable />

      <Modal isOpen={showAdjust} onClose={() => setShowAdjust(false)} title={t('adjustStock')}>
        <form onSubmit={adjustForm.handleSubmit(onAdjust)} className="space-y-4">
          <input placeholder={t('productName')} {...adjustForm.register('productId', { required: true })} className="w-full px-3 py-2 border rounded-lg" />
          <input placeholder={t('warehouses')} {...adjustForm.register('warehouseId', { required: true })} className="w-full px-3 py-2 border rounded-lg" />
          <input type="number" placeholder={tc('quantity')} {...adjustForm.register('quantity', { required: true, valueAsNumber: true })} className="w-full px-3 py-2 border rounded-lg" />
          <input placeholder={t('reason')} {...adjustForm.register('reason', { required: true })} className="w-full px-3 py-2 border rounded-lg" />
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={() => setShowAdjust(false)} className="px-4 py-2 bg-gray-100 rounded-lg">{tc('cancel')}</button>
            <button type="submit" disabled={adjustStock.isPending} className="px-4 py-2 bg-primary-600 text-white rounded-lg disabled:opacity-50">
              {adjustStock.isPending ? tc('loading') : tc('save')}
            </button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={showTransfer} onClose={() => setShowTransfer(false)} title={t('transferStock')}>
        <form onSubmit={transferForm.handleSubmit(onTransfer)} className="space-y-4">
          <input placeholder={t('productName')} {...transferForm.register('productId', { required: true })} className="w-full px-3 py-2 border rounded-lg" />
          <input placeholder={t('fromWarehouse')} {...transferForm.register('fromWarehouseId', { required: true })} className="w-full px-3 py-2 border rounded-lg" />
          <input placeholder={t('toWarehouse')} {...transferForm.register('toWarehouseId', { required: true })} className="w-full px-3 py-2 border rounded-lg" />
          <input type="number" placeholder={tc('quantity')} {...transferForm.register('quantity', { required: true, valueAsNumber: true })} className="w-full px-3 py-2 border rounded-lg" />
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={() => setShowTransfer(false)} className="px-4 py-2 bg-gray-100 rounded-lg">{tc('cancel')}</button>
            <button type="submit" disabled={transferStock.isPending} className="px-4 py-2 bg-primary-600 text-white rounded-lg disabled:opacity-50">
              {transferStock.isPending ? tc('loading') : tc('save')}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
