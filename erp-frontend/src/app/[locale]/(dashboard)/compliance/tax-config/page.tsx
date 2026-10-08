'use client';

import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { EntityForm, type FieldDef } from '@/components/operations/form';
import { num, Status, useModal, useNamer } from '@/components/operations/common';
import { useOpsMutation, useOpsQuery } from '@/hooks/use-operations';
import { opsCompliance } from '@/services/operations-compliance.service';
import type { Row } from '@/services/operations-api';

/** Tax rates per country (VAT 14% Egypt, 15% Saudi Arabia, table tax...). */
export default function TaxConfigPage() {
  const t = useTranslations('ops');
  const name = useNamer();
  const { data = [], isLoading } = useOpsQuery(['tax-configs'], opsCompliance.taxConfigs);
  const modal = useModal();
  const save = useOpsMutation((body: any) => opsCompliance.createTaxConfig(body), { invalidate: ['tax-configs'], onSuccess: () => modal.close() });
  const fields: FieldDef[] = [
    { name: 'country', label: t('comp.country'), type: 'select', required: true, options: [{ value: 'EG', label: t('comp.countries.EG') }, { value: 'SA', label: t('comp.countries.SA') }] },
    { name: 'taxType', label: t('comp.taxType'), required: true, placeholder: 'T1 / VAT' },
    { name: 'rate', label: t('comp.rate'), type: 'number', required: true, min: 0, max: 100 },
    { name: 'nameAr', label: t('common.nameAr'), required: true },
    { name: 'nameEn', label: t('common.nameEn'), required: true },
    { name: 'isActive', label: t('common.active'), type: 'checkbox' },
  ];
  return (
    <div>
      <PageHeader title={t('comp.taxConfig')} action={{ label: t('comp.newTaxConfig'), onClick: () => modal.open() }} />
      <DataTable
        data={data}
        loading={isLoading}
        searchable
        columns={[
          { key: 'country', header: t('comp.country'), render: (r: Row) => t(`comp.countries.${r.country}`) },
          { key: 'taxType', header: t('comp.taxType') },
          { key: 'nameAr', header: t('common.name'), render: (r: Row) => name(r) },
          { key: 'rate', header: t('comp.rate'), render: (r: Row) => `${num(r.rate)}%` },
          { key: 'isActive', header: t('common.status'), render: (r: Row) => <Status status={r.isActive ? 'active' : 'inactive'} /> },
        ]}
      />
      <Modal isOpen={modal.isOpen} onClose={modal.close} title={t('comp.newTaxConfig')}>
        <EntityForm fields={fields} initial={{ country: 'EG', isActive: true }} loading={save.isPending} onSubmit={(p) => save.mutate(p)} onCancel={modal.close} />
      </Modal>
    </div>
  );
}
