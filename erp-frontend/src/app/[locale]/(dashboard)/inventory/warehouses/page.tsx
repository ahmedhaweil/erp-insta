'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import StatusBadge from '@/components/ui/StatusBadge';
import { useWarehouses, useCreateWarehouse } from '@/hooks/use-products';
import { warehouseSchema, type WarehouseFormData } from '@/lib/validations/warehouse.schema';
import type { Warehouse } from '@/types';

export default function WarehousesPage() {
  const t = useTranslations('inventory');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [showModal, setShowModal] = useState(false);

  const { data: warehouses = [], isLoading } = useWarehouses();
  const createWarehouse = useCreateWarehouse();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<WarehouseFormData>({
    resolver: zodResolver(warehouseSchema),
  });

  const onSubmit = async (data: WarehouseFormData) => {
    await createWarehouse.mutateAsync(data);
    setShowModal(false);
    reset();
  };

  const columns = [
    { key: 'code', header: tc('code') },
    {
      key: 'name', header: tc('name'),
      render: (item: Warehouse) => locale === 'ar' ? item.nameAr : (item.nameEn || item.nameAr),
    },
    {
      key: 'isActive', header: tc('status'),
      render: (item: Warehouse) => <StatusBadge status={item.isActive ? 'active' : 'inactive'} label={item.isActive ? tc('active') : tc('inactive')} />,
    },
  ];

  return (
    <div>
      <PageHeader title={t('warehouses')} action={{ label: t('newWarehouse'), onClick: () => setShowModal(true) }} />
      <DataTable columns={columns} data={warehouses} loading={isLoading} searchable />

      <Modal isOpen={showModal} onClose={() => { setShowModal(false); reset(); }} title={t('newWarehouse')} size="lg">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{tc('code')}</label>
              <input {...register('code')} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
              {errors.code && <p className="text-xs text-red-500 mt-1">{errors.code.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Branch ID</label>
              <input {...register('branchId')} dir="ltr" placeholder="Branch UUID" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
              {errors.branchId && <p className="text-xs text-red-500 mt-1">{errors.branchId.message}</p>}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{tc('name')} (عربي)</label>
            <input {...register('nameAr')} dir="rtl" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
            {errors.nameAr && <p className="text-xs text-red-500 mt-1">{errors.nameAr.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{tc('name')} (English)</label>
            <input {...register('nameEn')} dir="ltr" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{tc('address')}</label>
            <input {...register('address')} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={() => { setShowModal(false); reset(); }} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm">{tc('cancel')}</button>
            <button type="submit" disabled={createWarehouse.isPending} className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm disabled:opacity-50">
              {createWarehouse.isPending ? tc('loading') : tc('save')}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
