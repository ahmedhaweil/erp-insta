'use client';

import { useTranslations } from 'next-intl';
import Modal from '@/components/ui/Modal';
import { EntityForm, type FieldDef } from '@/components/operations/form';
import { fmtMoney, num, today } from '@/components/operations/common';
import { useOpsMutation } from '@/hooks/use-operations';
import { opsSales } from '@/services/operations-sales.service';
import type { Row } from '@/services/operations-api';

/** Turns a posted invoice into an installment schedule. When no invoice is given, one is picked from the list. */
export default function InstallmentPlanModal({
  invoice,
  invoices,
  onClose,
}: {
  invoice?: Row | null;
  invoices?: Row[];
  onClose: () => void;
}) {
  const t = useTranslations('ops');
  const save = useOpsMutation((body: any) => opsSales.createInstallmentPlan(body), {
    invalidate: ['installment-plans', 'installments-due', 'sales-invoices'],
    onSuccess: onClose,
  });
  const fields: FieldDef[] = [
    {
      name: 'invoiceId',
      label: t('sales.invoice'),
      type: 'select',
      required: true,
      hidden: !!invoice,
      wide: true,
      options: (invoices ?? []).map((i) => ({
        value: i.id,
        label: `${i.invoiceNumber} - ${fmtMoney(num(i.totalAmount) - num(i.paidAmount))}`,
      })),
    },
    { name: 'numberOfInstallments', label: t('sales.numberOfInstallments'), type: 'number', required: true, min: 1, max: 360, step: '1' },
    {
      name: 'frequency',
      label: t('sales.frequency'),
      type: 'select',
      required: true,
      options: [
        { value: 'monthly', label: t('sales.frequencies.monthly') },
        { value: 'weekly', label: t('sales.frequencies.weekly') },
      ],
    },
    { name: 'downPayment', label: t('sales.downPayment'), type: 'number', min: 0 },
    { name: 'interestRate', label: t('sales.interestRate'), type: 'number', min: 0, hint: t('sales.interestRateHint') },
    { name: 'startDate', label: t('sales.startDate'), type: 'date' },
    { name: 'firstDueDate', label: t('sales.firstDueDate'), type: 'date' },
    { name: 'notes', label: t('common.notes'), wide: true },
  ];
  return (
    <Modal isOpen onClose={onClose} title={invoice ? `${t('sales.newPlan')} - ${invoice.invoiceNumber}` : t('sales.newPlan')} size="lg">
      {invoice && (
        <p className="text-sm text-gray-600 mb-3">
          {t('common.residual')}: <strong>{fmtMoney(num(invoice.totalAmount) - num(invoice.paidAmount))}</strong>
        </p>
      )}
      <EntityForm
        fields={fields}
        initial={{ invoiceId: invoice?.id, numberOfInstallments: 6, frequency: 'monthly', startDate: today() }}
        loading={save.isPending}
        onCancel={onClose}
        onSubmit={(p) => save.mutate({ ...p, invoiceId: invoice?.id ?? p.invoiceId, numberOfInstallments: Math.round(p.numberOfInstallments) })}
      />
    </Modal>
  );
}
