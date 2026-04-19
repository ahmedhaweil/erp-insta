'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import StatusBadge from '@/components/ui/StatusBadge';
import { useSuppliers, useCreateSupplier } from '@/hooks/use-purchasing';
import { supplierSchema, type SupplierFormData } from '@/lib/validations/supplier.schema';
import type { Supplier } from '@/types';

export default function SuppliersPage() {
  const t = useTranslations('purchasing');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);

  const { data: suppliers = [], isLoading } = useSuppliers();
  const createMutation = useCreateSupplier();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<SupplierFormData>({
    resolver: zodResolver(supplierSchema),
  });

  const onSubmit = async (data: SupplierFormData) => {
    await createMutation.mutateAsync(data);
    setShowModal(false);
    reset();
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
      <DataTable columns={columns} data={suppliers} loading={isLoading} searchable onRowClick={(item) => router.push(`/purchasing/suppliers/${item.id}`)} />

      <Modal isOpen={showModal} onClose={() => { setShowModal(false); reset(); }} title={t('newSupplier')} size="lg">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('supplierCode')}</label>
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
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('supplierName')} (عربي)</label>
            <input {...register('nameAr')} dir="rtl" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
            {errors.nameAr && <p className="text-xs text-red-500 mt-1">{errors.nameAr.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('supplierName')} (English)</label>
            <input {...register('nameEn')} dir="ltr" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{tc('email')}</label>
              <input type="email" {...register('email')} dir="ltr" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
              {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{tc('address')}</label>
              <input {...register('address')} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
            </div>
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
