'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import StatusBadge from '@/components/ui/StatusBadge';
import { useCustomers, useCreateCustomer, useDeleteCustomer } from '@/hooks/use-customers';
import { customerSchema, type CustomerFormData } from '@/lib/validations/customer.schema';
import type { Customer } from '@/types';

export default function CustomersPage() {
  const t = useTranslations('sales');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: customers = [], isLoading } = useCustomers();
  const createMutation = useCreateCustomer();
  const deleteMutation = useDeleteCustomer();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CustomerFormData>({
    resolver: zodResolver(customerSchema),
  });

  const onSubmit = async (data: CustomerFormData) => {
    await createMutation.mutateAsync({
      ...data,
      creditLimit: Number(data.creditLimit) || 0,
    });
    setShowModal(false);
    reset();
  };

  const columns = [
    { key: 'code', header: t('customerCode') },
    { key: 'name', header: t('customerName'), render: (item: Customer) => locale === 'ar' ? item.nameAr : (item.nameEn || item.nameAr) },
    { key: 'phone', header: tc('phone') },
    { key: 'taxId', header: t('taxId') },
    { key: 'balance', header: t('balance'), render: (item: Customer) => Number(item.balance).toFixed(2) },
    { key: 'creditLimit', header: t('creditLimit'), render: (item: Customer) => Number(item.creditLimit).toFixed(2) },
    { key: 'isActive', header: tc('status'), render: (item: Customer) => <StatusBadge status={item.isActive ? 'active' : 'inactive'} label={item.isActive ? tc('active') : tc('inactive')} /> },
    {
      key: 'actions', header: tc('actions'),
      render: (item: Customer) => (
        <button
          onClick={(e) => { e.stopPropagation(); setDeleteId(item.id); }}
          className="text-sm text-red-600 hover:underline"
        >
          {tc('delete')}
        </button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title={t('customers')} action={{ label: t('newCustomer'), onClick: () => setShowModal(true) }} />
      <DataTable
        columns={columns}
        data={customers}
        loading={isLoading}
        searchable
        onRowClick={(item) => router.push(`/sales/customers/${item.id}`)}
      />

      <ConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId) {
            deleteMutation.mutate(deleteId, { onSettled: () => setDeleteId(null) });
          }
        }}
        title={tc('confirmDelete')}
        message={tc('confirmDeleteMessage')}
        destructive
        loading={deleteMutation.isPending}
      />

      <Modal isOpen={showModal} onClose={() => { setShowModal(false); reset(); }} title={t('newCustomer')} size="lg">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('customerCode')}</label>
              <input {...register('code')} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
              {errors.code && <p className="text-xs text-red-500 mt-1">{errors.code.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{tc('phone')}</label>
              <input {...register('phone')} dir="ltr" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
              {errors.phone && <p className="text-xs text-red-500 mt-1">{errors.phone.message}</p>}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('customerName')} (عربي)</label>
            <input {...register('nameAr')} dir="rtl" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
            {errors.nameAr && <p className="text-xs text-red-500 mt-1">{errors.nameAr.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('customerName')} (English)</label>
            <input {...register('nameEn')} dir="ltr" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{tc('email')}</label>
              <input type="email" {...register('email')} dir="ltr" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
              {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('taxId')}</label>
              <input {...register('taxId')} dir="ltr" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{tc('address')}</label>
            <input {...register('address')} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('creditLimit')}</label>
            <input type="number" step="0.01" {...register('creditLimit')} dir="ltr" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={() => { setShowModal(false); reset(); }} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm">{tc('cancel')}</button>
            <button type="submit" disabled={createMutation.isPending} className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm disabled:opacity-50">
              {createMutation.isPending ? tc('loading') : tc('save')}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
