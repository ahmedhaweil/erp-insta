'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { inventoryService } from '@/services/inventory.service';
import type { Stock } from '@/types';

export default function StockPage() {
  const t = useTranslations('inventory');
  const tc = useTranslations('common');
  const [stock, setStock] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdjust, setShowAdjust] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [adjustForm, setAdjustForm] = useState({ productId: '', warehouseId: '', quantity: '', reason: '' });
  const [transferForm, setTransferForm] = useState({ productId: '', fromWarehouseId: '', toWarehouseId: '', quantity: '' });

  useEffect(() => { loadStock(); }, []);

  const loadStock = async () => {
    try { setStock(await inventoryService.getStock()); }
    catch { /* handle */ }
    finally { setLoading(false); }
  };

  const handleAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    await inventoryService.adjustStock({ ...adjustForm, quantity: Number(adjustForm.quantity) });
    setShowAdjust(false);
    loadStock();
  };

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    await inventoryService.transferStock({ ...transferForm, quantity: Number(transferForm.quantity) });
    setShowTransfer(false);
    loadStock();
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
      <DataTable columns={columns} data={stock.map((s, i) => ({ ...s, id: `${s.productId}-${s.warehouseId}` }))} loading={loading} />

      <Modal isOpen={showAdjust} onClose={() => setShowAdjust(false)} title={t('adjustStock')}>
        <form onSubmit={handleAdjust} className="space-y-4">
          <input placeholder={t('productName')} value={adjustForm.productId} onChange={(e) => setAdjustForm({ ...adjustForm, productId: e.target.value })} required className="w-full px-3 py-2 border rounded-lg" />
          <input placeholder={t('warehouses')} value={adjustForm.warehouseId} onChange={(e) => setAdjustForm({ ...adjustForm, warehouseId: e.target.value })} required className="w-full px-3 py-2 border rounded-lg" />
          <input type="number" placeholder={tc('quantity')} value={adjustForm.quantity} onChange={(e) => setAdjustForm({ ...adjustForm, quantity: e.target.value })} required className="w-full px-3 py-2 border rounded-lg" />
          <input placeholder={t('reason')} value={adjustForm.reason} onChange={(e) => setAdjustForm({ ...adjustForm, reason: e.target.value })} required className="w-full px-3 py-2 border rounded-lg" />
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={() => setShowAdjust(false)} className="px-4 py-2 bg-gray-100 rounded-lg">{tc('cancel')}</button>
            <button type="submit" className="px-4 py-2 bg-primary-600 text-white rounded-lg">{tc('save')}</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={showTransfer} onClose={() => setShowTransfer(false)} title={t('transferStock')}>
        <form onSubmit={handleTransfer} className="space-y-4">
          <input placeholder={t('productName')} value={transferForm.productId} onChange={(e) => setTransferForm({ ...transferForm, productId: e.target.value })} required className="w-full px-3 py-2 border rounded-lg" />
          <input placeholder={t('fromWarehouse')} value={transferForm.fromWarehouseId} onChange={(e) => setTransferForm({ ...transferForm, fromWarehouseId: e.target.value })} required className="w-full px-3 py-2 border rounded-lg" />
          <input placeholder={t('toWarehouse')} value={transferForm.toWarehouseId} onChange={(e) => setTransferForm({ ...transferForm, toWarehouseId: e.target.value })} required className="w-full px-3 py-2 border rounded-lg" />
          <input type="number" placeholder={tc('quantity')} value={transferForm.quantity} onChange={(e) => setTransferForm({ ...transferForm, quantity: e.target.value })} required className="w-full px-3 py-2 border rounded-lg" />
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={() => setShowTransfer(false)} className="px-4 py-2 bg-gray-100 rounded-lg">{tc('cancel')}</button>
            <button type="submit" className="px-4 py-2 bg-primary-600 text-white rounded-lg">{tc('save')}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
