'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import StatusBadge from '@/components/ui/StatusBadge';
import { useProducts, useCreateProduct } from '@/hooks/use-products';
import { productSchema, type ProductFormData } from '@/lib/validations/product.schema';
import type { Product } from '@/types';

export default function ProductsPage() {
  const t = useTranslations('inventory');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [showModal, setShowModal] = useState(false);

  const { data: products = [], isLoading } = useProducts();
  const createProduct = useCreateProduct();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ProductFormData>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      code: '', nameAr: '', nameEn: '', type: 'goods',
      barcode: '', sku: '', categoryId: '', unitId: '',
      costPrice: '', sellPrice: '',
    },
  });

  const onSubmit = (data: ProductFormData) => {
    const payload = {
      ...data,
      costPrice: Number(data.costPrice) || 0,
      sellPrice: Number(data.sellPrice) || 0,
      reorderLevel: Number(data.reorderLevel) || 0,
      reorderQty: Number(data.reorderQty) || 0,
    };
    createProduct.mutate(payload, {
      onSuccess: () => {
        setShowModal(false);
        reset();
      },
    });
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
      <DataTable columns={columns} data={products} loading={isLoading} searchable />

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={t('newProduct')} size="lg">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('productCode')}</label>
              <input {...register('code')} className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500" />
              {errors.code && <p className="text-sm text-red-600 mt-1">{errors.code.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{tc('unit')}</label>
              <select {...register('type')} className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500">
                <option value="goods">{t('goods')}</option>
                <option value="service">{t('service')}</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('productName')} ({'\u0639\u0631\u0628\u064A'})</label>
            <input {...register('nameAr')} dir="rtl" className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500" />
            {errors.nameAr && <p className="text-sm text-red-600 mt-1">{errors.nameAr.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('productName')} (English)</label>
            <input {...register('nameEn')} dir="ltr" className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('barcode')}</label>
              <input {...register('barcode')} dir="ltr" className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('sku')}</label>
              <input {...register('sku')} dir="ltr" className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('costPrice')}</label>
              <input type="number" step="0.01" {...register('costPrice')} dir="ltr" className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500" />
              {errors.costPrice && <p className="text-sm text-red-600 mt-1">{errors.costPrice.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('sellPrice')}</label>
              <input type="number" step="0.01" {...register('sellPrice')} dir="ltr" className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500" />
              {errors.sellPrice && <p className="text-sm text-red-600 mt-1">{errors.sellPrice.message}</p>}
            </div>
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">{tc('cancel')}</button>
            <button type="submit" disabled={createProduct.isPending} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">
              {createProduct.isPending ? tc('loading') : tc('save')}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
