'use client';

import { useState, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import StatusBadge from '@/components/ui/StatusBadge';
import { complianceService } from '@/services/compliance.service';
import type { TaxConfig } from '@/types';

export default function TaxConfigPage() {
  const t = useTranslations('compliance');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [configs, setConfigs] = useState<TaxConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ country: 'EG' as 'EG' | 'SA', taxType: '', rate: '', nameAr: '', nameEn: '' });

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try { setConfigs(await complianceService.getTaxConfigs()); }
    catch { /* handle */ }
    finally { setLoading(false); }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await complianceService.createTaxConfig({ ...form, rate: Number(form.rate) } as any);
    setShowModal(false);
    loadData();
  };

  const columns = [
    { key: 'country', header: t('country'), render: (item: TaxConfig) => item.country === 'EG' ? t('egypt') : t('saudiArabia') },
    { key: 'name', header: tc('name'), render: (item: TaxConfig) => locale === 'ar' ? item.nameAr : (item.nameEn || item.nameAr) },
    { key: 'taxType', header: t('taxType') },
    { key: 'rate', header: t('taxRate'), render: (item: TaxConfig) => `${Number(item.rate)}%` },
    { key: 'isActive', header: tc('status'), render: (item: TaxConfig) => <StatusBadge status={item.isActive ? 'active' : 'inactive'} label={item.isActive ? tc('active') : tc('inactive')} /> },
  ];

  return (
    <div>
      <PageHeader title={t('taxConfig')} action={{ label: tc('create'), onClick: () => setShowModal(true) }} />
      <DataTable columns={columns} data={configs} loading={loading} />

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={t('taxConfig')}>
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('country')}</label>
            <select value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value as any })} className="w-full px-3 py-2 border border-gray-300 rounded-lg">
              <option value="EG">{t('egypt')}</option>
              <option value="SA">{t('saudiArabia')}</option>
            </select>
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t('taxType')}</label><input value={form.taxType} onChange={(e) => setForm({ ...form, taxType: e.target.value })} required className="w-full px-3 py-2 border rounded-lg" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t('taxRate')} (%)</label><input type="number" step="0.01" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} required dir="ltr" className="w-full px-3 py-2 border rounded-lg" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{tc('name')} (عربي)</label><input value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} required dir="rtl" className="w-full px-3 py-2 border rounded-lg" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{tc('name')} (English)</label><input value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} dir="ltr" className="w-full px-3 py-2 border rounded-lg" /></div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 bg-gray-100 rounded-lg">{tc('cancel')}</button>
            <button type="submit" className="px-4 py-2 bg-primary-600 text-white rounded-lg">{tc('save')}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
