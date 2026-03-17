'use client';

import { useState, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import StatusBadge from '@/components/ui/StatusBadge';
import { accountingService } from '@/services/accounting.service';
import type { Account } from '@/types';

export default function AccountsPage() {
  const t = useTranslations('accounting');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ code: '', nameAr: '', nameEn: '', type: 'asset', parentId: '', description: '' });

  useEffect(() => {
    loadAccounts();
  }, []);

  const loadAccounts = async () => {
    try {
      const data = await accountingService.getAccounts();
      setAccounts(data);
    } catch {
      // handle error
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await accountingService.createAccount({
        ...form,
        parentId: form.parentId || undefined,
      } as any);
      setShowModal(false);
      setForm({ code: '', nameAr: '', nameEn: '', type: 'asset', parentId: '', description: '' });
      loadAccounts();
    } catch {
      // handle error
    }
  };

  const columns = [
    { key: 'code', header: t('accountCode') },
    {
      key: 'name',
      header: tc('name'),
      render: (item: Account) => locale === 'ar' ? item.nameAr : (item.nameEn || item.nameAr),
    },
    {
      key: 'type',
      header: t('accountType'),
      render: (item: Account) => <StatusBadge status={item.type} label={t(item.type)} />,
    },
    { key: 'level', header: 'Level' },
    {
      key: 'isActive',
      header: tc('status'),
      render: (item: Account) => (
        <StatusBadge status={item.isActive ? 'active' : 'inactive'} label={item.isActive ? tc('active') : tc('inactive')} />
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('chartOfAccounts')}
        action={{ label: t('newAccount'), onClick: () => setShowModal(true) }}
      />
      <DataTable columns={columns} data={accounts} loading={loading} />

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={t('newAccount')} size="lg">
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('accountCode')}</label>
              <input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('accountType')}</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500"
              >
                {['asset', 'liability', 'equity', 'revenue', 'expense'].map((type) => (
                  <option key={type} value={type}>{t(type)}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('accountNameAr')}</label>
            <input
              value={form.nameAr}
              onChange={(e) => setForm({ ...form, nameAr: e.target.value })}
              required
              dir="rtl"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('accountNameEn')}</label>
            <input
              value={form.nameEn}
              onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
              dir="ltr"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{tc('description')}</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">
              {tc('cancel')}
            </button>
            <button type="submit" className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">
              {tc('save')}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
