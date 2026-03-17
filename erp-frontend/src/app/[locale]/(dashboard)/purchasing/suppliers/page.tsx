'use client';

import { useState, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import StatusBadge from '@/components/ui/StatusBadge';
import { purchasingService } from '@/services/purchasing.service';
import type { Supplier } from '@/types';

export default function SuppliersPage() {
  const t = useTranslations('purchasing');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ code: '', nameAr: '', nameEn: '', phone: '', email: '', taxId: '', address: '' });

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try { setSuppliers(await purchasingService.getSuppliers()); }
    catch { /* handle */ }
    finally { setLoading(false); }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await purchasingService.createSupplier(form as any);
    setShowModal(false);
    loadData();
  };

  const columns = [
    { key: 'code', header: t('supplierCode') },
    { key: 'name', header: t('supplierName'), render: (item: Supplier) => locale === 'ar' ? item.nameAr : (item.nameEn || item.nameAr) },
    { key: 'phone', header: tc('phone') },
    { key: 'balance', header: tc('amount'), render: (item: Supplier) => Number(item.balance).toFixed(2) },
    { key: 'isActive', header: tc('status'), render: (item: Supplier) => <StatusBadge status={item.isActive ? 'active' : 'inactive'} label={item.isActive ? tc('active') : tc('inactive')} /> },
  ];

  return (
    <div>
      <PageHeader title={t('suppliers')} action={{ label: t('newSupplier'), onClick: () => setShowModal(true) }} />
      <DataTable columns={columns} data={suppliers} loading={loading} />

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={t('newSupplier')} size="lg">
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t('supplierCode')}</label><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required className="w-full px-3 py-2 border border-gray-300 rounded-lg" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{tc('phone')}</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required dir="ltr" className="w-full px-3 py-2 border border-gray-300 rounded-lg" /></div>
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t('supplierName')} (عربي)</label><input value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} required dir="rtl" className="w-full px-3 py-2 border border-gray-300 rounded-lg" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t('supplierName')} (English)</label><input value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} dir="ltr" className="w-full px-3 py-2 border border-gray-300 rounded-lg" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{tc('email')}</label><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} dir="ltr" className="w-full px-3 py-2 border border-gray-300 rounded-lg" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{tc('address')}</label><input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" /></div>
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 bg-gray-100 rounded-lg">{tc('cancel')}</button>
            <button type="submit" className="px-4 py-2 bg-primary-600 text-white rounded-lg">{tc('save')}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
