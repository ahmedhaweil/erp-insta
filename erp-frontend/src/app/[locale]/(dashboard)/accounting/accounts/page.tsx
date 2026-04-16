'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import StatusBadge from '@/components/ui/StatusBadge';
import { useAccounts, useCreateAccount } from '@/hooks/use-accounting';
import { accountSchema, type AccountFormData } from '@/lib/validations/account.schema';
import type { Account } from '@/types';

export default function AccountsPage() {
  const t = useTranslations('accounting');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [showModal, setShowModal] = useState(false);

  const { data: accounts = [], isLoading } = useAccounts();
  const createAccount = useCreateAccount();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AccountFormData>({
    resolver: zodResolver(accountSchema),
    defaultValues: { code: '', nameAr: '', nameEn: '', type: 'asset', parentId: '', description: '' },
  });

  const onSubmit = (data: AccountFormData) => {
    createAccount.mutate(
      { ...data, parentId: data.parentId || undefined },
      {
        onSuccess: () => {
          setShowModal(false);
          reset();
        },
      },
    );
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
      <DataTable columns={columns} data={accounts} loading={isLoading} searchable />

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={t('newAccount')} size="lg">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('accountCode')}</label>
              <input
                {...register('code')}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500"
              />
              {errors.code && <p className="text-sm text-red-600 mt-1">{errors.code.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('accountType')}</label>
              <select
                {...register('type')}
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
              {...register('nameAr')}
              dir="rtl"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500"
            />
            {errors.nameAr && <p className="text-sm text-red-600 mt-1">{errors.nameAr.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('accountNameEn')}</label>
            <input
              {...register('nameEn')}
              dir="ltr"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{tc('description')}</label>
            <textarea
              {...register('description')}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">
              {tc('cancel')}
            </button>
            <button type="submit" disabled={createAccount.isPending} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">
              {createAccount.isPending ? tc('loading') : tc('save')}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
