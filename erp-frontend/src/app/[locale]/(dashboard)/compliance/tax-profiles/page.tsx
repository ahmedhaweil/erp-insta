'use client';

import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { EntityForm, type FieldDef } from '@/components/operations/form';
import { RowAction, useModal, useNamer } from '@/components/operations/common';
import { useOpsCustomers, useOpsMutation, useOpsQuery } from '@/hooks/use-operations';
import { opsCompliance } from '@/services/operations-compliance.service';
import type { Row } from '@/services/operations-api';

/** Receiver data used on e-invoices (ETA receiver / ZATCA buyer) per customer. */
export default function TaxProfilesPage() {
  const t = useTranslations('ops');
  const name = useNamer();
  const { data: customers = [], isLoading } = useOpsCustomers();
  const modal = useModal<Row>();
  return (
    <div>
      <PageHeader title={t('comp.taxProfiles')} />
      <p className="text-sm text-gray-600 mb-4">{t('comp.taxProfilesHint')}</p>
      <DataTable
        data={customers}
        loading={isLoading}
        searchable
        pageSize={20}
        onRowClick={(c: Row) => modal.open(c)}
        columns={[
          { key: 'code', header: t('common.code') },
          { key: 'nameAr', header: t('common.name'), render: (c: Row) => name(c) },
          { key: 'taxId', header: t('common.taxId') },
          { key: 'city', header: t('common.city') },
        ]}
        actions={(c: Row) => <RowAction onClick={() => modal.open(c)}>{t('comp.editProfile')}</RowAction>}
      />
      {modal.data && <ProfileModal customer={modal.data} onClose={modal.close} />}
    </div>
  );
}

function ProfileModal({ customer, onClose }: { customer: Row; onClose: () => void }) {
  const t = useTranslations('ops');
  const name = useNamer();
  const { data: party, isLoading } = useOpsQuery(['party', customer.id], () => opsCompliance.party(customer.id));
  const save = useOpsMutation((body: any) => opsCompliance.upsertParty(customer.id, body), { invalidate: ['party'], onSuccess: onClose });
  const fields: FieldDef[] = [
    {
      name: 'receiverType',
      label: t('comp.receiverType'),
      type: 'select',
      required: true,
      options: ['B', 'P', 'F'].map((x) => ({ value: x, label: t(`comp.receiverTypes.${x}`) })),
    },
    { name: 'identifier', label: t('comp.identifier'), hint: t('comp.identifierHint') },
    { name: 'countryCode', label: t('comp.countryCode'), placeholder: 'EG' },
    { name: 'governate', label: t('comp.governate') },
    { name: 'regionCity', label: t('comp.regionCity') },
    { name: 'district', label: t('comp.district') },
    { name: 'street', label: t('comp.street') },
    { name: 'buildingNumber', label: t('comp.buildingNumber') },
    { name: 'postalCode', label: t('comp.postalCode') },
    { name: 'otherIdScheme', label: t('comp.otherIdScheme'), hint: t('comp.otherIdSchemeHint') },
    { name: 'otherId', label: t('comp.otherId') },
  ];
  return (
    <Modal isOpen onClose={onClose} title={`${t('comp.taxProfile')} - ${name(customer)}`} size="xl">
      {isLoading ? (
        <p className="text-sm text-gray-500">{t('common.loading')}</p>
      ) : (
        <EntityForm
          fields={fields}
          columns={3}
          initial={party ?? { receiverType: customer.taxId ? 'B' : 'P', identifier: customer.taxId ?? '', countryCode: 'EG', regionCity: customer.city ?? '', street: customer.address ?? '' }}
          loading={save.isPending}
          onSubmit={(p) => save.mutate(p)}
          onCancel={onClose}
        />
      )}
    </Modal>
  );
}
