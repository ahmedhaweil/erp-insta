'use client';

import { useState, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import StatusBadge from '@/components/ui/StatusBadge';
import { inventoryService } from '@/services/inventory.service';
import type { Product } from '@/types';

export default function ProductsPage() {
  const t = useTranslations('inventory');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    code: '', nameAr: '', nameEn: '', type: 'goods' as const,
    barcode: '', sku: '', costPrice: '', sellPrice: '',
  });

  useEffect(() => { loadProducts(); }, []);

  const loadProducts = async () => {
    try { setProducts(await inventoryService.getProducts()); }
    catch { /* handle */ }
    finally { setLoading(false); }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await inventoryService.createProduct({
        ...form,
        costPrice: Number(form.costPrice),
        sellPrice: Number(form.sellPrice),
      } as any);
      setShowModal(false);
      loadProducts();
    } catch { /* handle */ }
  };

  const columns = [
    { key: 'code', header: t('productCode') },
    {
      key: 'name', header: t('productName'),
      render: (item: Product) => locale === 'ar' ? item.nameAr : (item.nameEn || item.nameAr),
    },
    {
      key: 'type', header: tc('status'),
      render: (item: Product) => <StatusBadge status={item.type} label={t(item.type)} />,
    },
    { key: 'costPrice', header: t('costPrice'), render: (item: Product) => Number(item.costPrice).toFixed(2) },
    { key: 'sellPrice', header: t('sellPrice'), render: (item: Product) => Number(item.sellPrice).toFixed(2) },
    {
      key: 'isActive', header: tc('status'),
      render: (item: Product) => <StatusBadge status={item.isActive ? 'active' : 'inactive'} label={item.isActive ? tc('active') : tc('inactive')} />,
    },
  ];

  return (
    <div>
      <PageHeader title={t('products')} action={{ label: t('newProduct'), onClick: () => setShowModal(true) }} />
      <DataTable columns={columns} data={products} loading={loading} />

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={t('newProduct')} size="lg">
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('productCode')}</label>
              <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{tc('unit')}</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as any })} className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500">
                <option value="goods">{t('goods')}</option>
                <option value="service">{t('service')}</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('productName')} (عربي)</label>
            <input value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} required dir="rtl" className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('productName')} (English)</label>
            <input value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} dir="ltr" className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('barcode')}</label>
              <input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} dir="ltr" className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('sku')}</label>
              <input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} dir="ltr" className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('costPrice')}</label>
              <input type="number" step="0.01" value={form.costPrice} onChange={(e) => setForm({ ...form, costPrice: e.target.value })} required dir="ltr" className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('sellPrice')}</label>
              <input type="number" step="0.01" value={form.sellPrice} onChange={(e) => setForm({ ...form, sellPrice: e.target.value })} required dir="ltr" className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">{tc('cancel')}</button>
            <button type="submit" className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">{tc('save')}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
