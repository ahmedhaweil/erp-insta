'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter, Link } from '@/i18n/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { supplierSchema, type SupplierFormData } from '@/lib/validations/supplier.schema';
import { useSupplier, useUpdateSupplier, useDeleteSupplier, usePurchaseOrders, usePurchaseInvoices } from '@/hooks/use-purchasing';
import StatusBadge from '@/components/ui/StatusBadge';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { PurchaseOrder, PurchaseInvoice } from '@/types';

export default function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations('purchasing');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const [editMode, setEditMode] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const { data: supplier, isLoading } = useSupplier(id);
  const { data: orders = [] } = usePurchaseOrders();
  const { data: invoices = [] } = usePurchaseInvoices();
  const updateMutation = useUpdateSupplier();
  const deleteMutation = useDeleteSupplier();

  const { register, handleSubmit, reset, formState: { errors } } = useForm<SupplierFormData>({
    resolver: zodResolver(supplierSchema),
    values: supplier ? {
      code: supplier.code,
      nameAr: supplier.nameAr,
      nameEn: supplier.nameEn || '',
      phone: supplier.phone,
      email: supplier.email || '',
      taxId: supplier.taxId || '',
      address: '',
    } : undefined,
  });

  if (isLoading) return <div className="p-8 text-center text-gray-500">{tc('loading')}</div>;
  if (!supplier) return <div className="p-8 text-center text-gray-500">{tc('noData')}</div>;

  const name = locale === 'ar' ? supplier.nameAr : (supplier.nameEn || supplier.nameAr);
  const supplierOrders = (orders as PurchaseOrder[]).filter(o => o.supplierId === supplier.id);
  const supplierInvoices = (invoices as PurchaseInvoice[]).filter(i => i.supplierId === supplier.id);

  const onSubmit = async (data: SupplierFormData) => {
    await updateMutation.mutateAsync({ id, data });
    setEditMode(false);
  };

  const handleDelete = async () => {
    await deleteMutation.mutateAsync(id);
    router.push('/purchasing/suppliers');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/purchasing/suppliers" className="text-sm text-gray-500 hover:text-gray-700">← {tc('back')}</Link>
          <h1 className="text-2xl font-bold text-gray-900">{name}</h1>
          <StatusBadge status={supplier.isActive ? 'active' : 'inactive'} label={supplier.isActive ? tc('active') : tc('inactive')} />
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
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('supplierCode')}</label>
                <input {...register('code')} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
                {errors.code && <p className="text-xs text-red-500 mt-1">{errors.code.message}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{tc('phone')}</label>
                <input {...register('phone')} dir="ltr" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
                {errors.phone && <p className="text-xs text-red-500 mt-1">{errors.phone.message}</p>}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('supplierName')} (عربي)</label>
              <input {...register('nameAr')} dir="rtl" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
              {errors.nameAr && <p className="text-xs text-red-500 mt-1">{errors.nameAr.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('supplierName')} (English)</label>
              <input {...register('nameEn')} dir="ltr" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{tc('email')}</label>
                <input type="email" {...register('email')} dir="ltr" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('taxId')}</label>
                <input {...register('taxId')} dir="ltr" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => { setEditMode(false); reset(); }} className="px-4 py-2 bg-gray-100 rounded-lg text-sm">{tc('cancel')}</button>
              <button type="submit" disabled={updateMutation.isPending} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm disabled:opacity-50">{updateMutation.isPending ? tc('loading') : tc('save')}</button>
            </div>
          </form>
        ) : (
          <div className="grid grid-cols-2 gap-6">
            <InfoRow label={t('supplierCode')} value={supplier.code} />
            <InfoRow label={tc('phone')} value={supplier.phone} />
            <InfoRow label={`${t('supplierName')} (عربي)`} value={supplier.nameAr} />
            <InfoRow label={`${t('supplierName')} (EN)`} value={supplier.nameEn || '-'} />
            <InfoRow label={tc('email')} value={supplier.email || '-'} />
            <InfoRow label={t('taxId')} value={supplier.taxId || '-'} />
            <InfoRow label={t('balance')} value={Number(supplier.balance).toFixed(2)} />
            <InfoRow label={t('creditLimit')} value={Number(supplier.creditLimit).toFixed(2)} />
          </div>
        )}
      </div>

      {/* Related Purchase Orders */}
      {supplierOrders.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold mb-4">{t('orders')}</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-start py-2">{t('orderNumber')}</th>
                <th className="text-start py-2">{tc('date')}</th>
                <th className="text-start py-2">{tc('status')}</th>
                <th className="text-end py-2">{tc('total')}</th>
              </tr>
            </thead>
            <tbody>
              {supplierOrders.map(o => (
                <tr key={o.id} className="border-b last:border-0 hover:bg-gray-50 cursor-pointer" onClick={() => router.push(`/purchasing/orders/${o.id}`)}>
                  <td className="py-2">{o.orderNumber}</td>
                  <td className="py-2">{o.date}</td>
                  <td className="py-2"><StatusBadge status={o.status} label={tc(o.status as any)} /></td>
                  <td className="py-2 text-end">{Number(o.totalAmount).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Related Purchase Invoices */}
      {supplierInvoices.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold mb-4">{t('invoices')}</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-start py-2">{t('invoiceNumber')}</th>
                <th className="text-start py-2">{tc('date')}</th>
                <th className="text-start py-2">{tc('status')}</th>
                <th className="text-end py-2">{tc('total')}</th>
              </tr>
            </thead>
            <tbody>
              {supplierInvoices.map(i => (
                <tr key={i.id} className="border-b last:border-0 hover:bg-gray-50 cursor-pointer" onClick={() => router.push(`/purchasing/invoices/${i.id}`)}>
                  <td className="py-2">{i.invoiceNumber}</td>
                  <td className="py-2">{i.date}</td>
                  <td className="py-2"><StatusBadge status={i.status} label={tc(i.status as any)} /></td>
                  <td className="py-2 text-end">{Number(i.totalAmount).toFixed(2)}</td>
                </tr>
              ))}
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
