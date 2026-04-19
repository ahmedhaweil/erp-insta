'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter, Link } from '@/i18n/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { productSchema, type ProductFormData } from '@/lib/validations/product.schema';
import { useProduct, useUpdateProduct, useDeleteProduct, useStock, useWarehouses } from '@/hooks/use-products';
import StatusBadge from '@/components/ui/StatusBadge';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { Stock, Warehouse } from '@/types';

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations('inventory');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const [editMode, setEditMode] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const { data: product, isLoading } = useProduct(id);
  const { data: stockData = [] } = useStock();
  const { data: warehouses = [] } = useWarehouses();
  const updateMutation = useUpdateProduct();
  const deleteMutation = useDeleteProduct();

  const { register, handleSubmit, reset, formState: { errors } } = useForm<ProductFormData>({
    resolver: zodResolver(productSchema),
    values: product ? {
      code: product.code,
      nameAr: product.nameAr,
      nameEn: product.nameEn || '',
      type: product.type,
      barcode: product.barcode || '',
      sku: product.sku || '',
      categoryId: product.categoryId || '',
      unitId: '',
      costPrice: String(product.costPrice),
      sellPrice: String(product.sellPrice),
      reorderLevel: '',
      reorderQty: '',
      description: '',
    } : undefined,
  });

  if (isLoading) return <div className="p-8 text-center text-gray-500">{tc('loading')}</div>;
  if (!product) return <div className="p-8 text-center text-gray-500">{tc('noData')}</div>;

  const name = locale === 'ar' ? product.nameAr : (product.nameEn || product.nameAr);
  const productStock = (stockData as Stock[]).filter(s => s.productId === product.id);

  const onSubmit = async (data: ProductFormData) => {
    await updateMutation.mutateAsync({ id, data: { ...data, costPrice: Number(data.costPrice) || 0, sellPrice: Number(data.sellPrice) || 0 } });
    setEditMode(false);
  };

  const handleDelete = async () => {
    await deleteMutation.mutateAsync(id);
    router.push('/inventory/products');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/inventory/products" className="text-sm text-gray-500 hover:text-gray-700">← {tc('back')}</Link>
          <h1 className="text-2xl font-bold text-gray-900">{name}</h1>
          <StatusBadge status={product.isActive ? 'active' : 'inactive'} label={product.isActive ? tc('active') : tc('inactive')} />
        </div>
        <div className="flex gap-2">
          {!editMode && (
            <>
              <button onClick={() => setEditMode(true)} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700">{tc('edit')}</button>
              <button onClick={() => setShowDeleteDialog(true)} className="px-4 py-2 bg-red-100 text-red-700 rounded-lg text-sm hover:bg-red-200">{tc('delete')}</button>
            </>
          )}
        </div>
      </div>

      {/* Info Card */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold mb-4">{tc('details')}</h2>
        {editMode ? (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('productCode')}</label>
                <input {...register('code')} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
                {errors.code && <p className="text-xs text-red-500 mt-1">{errors.code.message}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{tc('unit')}</label>
                <select {...register('type')} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500">
                  <option value="goods">{t('goods')}</option>
                  <option value="service">{t('service')}</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('productName')} (عربي)</label>
              <input {...register('nameAr')} dir="rtl" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
              {errors.nameAr && <p className="text-xs text-red-500 mt-1">{errors.nameAr.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('productName')} (English)</label>
              <input {...register('nameEn')} dir="ltr" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('barcode')}</label>
                <input {...register('barcode')} dir="ltr" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('sku')}</label>
                <input {...register('sku')} dir="ltr" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('costPrice')}</label>
                <input type="number" step="0.01" {...register('costPrice')} dir="ltr" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('sellPrice')}</label>
                <input type="number" step="0.01" {...register('sellPrice')} dir="ltr" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => { setEditMode(false); reset(); }} className="px-4 py-2 bg-gray-100 rounded-lg text-sm">{tc('cancel')}</button>
              <button type="submit" disabled={updateMutation.isPending} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm disabled:opacity-50">{updateMutation.isPending ? tc('loading') : tc('save')}</button>
            </div>
          </form>
        ) : (
          <div className="grid grid-cols-2 gap-6">
            <InfoRow label={t('productCode')} value={product.code} />
            <InfoRow label={tc('status')} value={product.type === 'goods' ? t('goods') : t('service')} />
            <InfoRow label={`${t('productName')} (عربي)`} value={product.nameAr} />
            <InfoRow label={`${t('productName')} (EN)`} value={product.nameEn || '-'} />
            <InfoRow label={t('barcode')} value={product.barcode || '-'} />
            <InfoRow label={t('sku')} value={product.sku || '-'} />
            <InfoRow label={t('costPrice')} value={Number(product.costPrice).toFixed(2)} />
            <InfoRow label={t('sellPrice')} value={Number(product.sellPrice).toFixed(2)} />
          </div>
        )}
      </div>

      {/* Stock Levels */}
      {productStock.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold mb-4">{t('stockLevels')}</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-start py-2">{tc('name')}</th>
                <th className="text-end py-2">{t('currentStock')}</th>
                <th className="text-end py-2">{t('reserved')}</th>
                <th className="text-end py-2">{t('available')}</th>
              </tr>
            </thead>
            <tbody>
              {productStock.map(s => {
                const wh = (warehouses as Warehouse[]).find(w => w.id === s.warehouseId);
                return (
                  <tr key={s.warehouseId} className="border-b last:border-0">
                    <td className="py-2">{locale === 'ar' ? wh?.nameAr : (wh?.nameEn || wh?.nameAr)}</td>
                    <td className="py-2 text-end">{s.quantity}</td>
                    <td className="py-2 text-end">{s.reservedQty}</td>
                    <td className="py-2 text-end">{Number(s.quantity) - Number(s.reservedQty)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={handleDelete}
        title={tc('delete')}
        message={tc('confirmDelete')}
        destructive
        loading={deleteMutation.isPending}
      />
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-sm font-medium text-gray-900">{value}</p>
    </div>
  );
}
