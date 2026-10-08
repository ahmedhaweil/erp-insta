'use client';

import { useState, type FormEvent } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import LeadForm from '@/components/people/LeadForm';
import { ActivityFormModal, ActivityTable } from '@/components/people/ActivityList';
import { Button, Card, Field, FormActions, Input, Select, Tabs, todayIso } from '@/components/people/ui';
import { useCustomers, useLabelMap, usePeopleMutation, usePeopleQuery, useProducts, useWarehouses } from '@/hooks/use-people';
import { crmService } from '@/services/people-crm.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const COLORS: Record<string, string> = { open: 'open', won: 'completed', lost: 'cancelled' };
type Dialog = 'lost' | 'customer' | 'quotation' | 'activity' | 'delete' | null;

function CustomerDialog({ leadId, onClose, defaultName }: { leadId: string; onClose: () => void; defaultName: string }) {
  const t = useTranslations('crm');
  const tc = useTranslations('common');
  const { data: customers } = useCustomers();
  const customerMap = useLabelMap(customers);
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [form, setForm] = useState({ customerId: '', code: '', nameAr: defaultName, nameEn: defaultName, taxId: '', paymentTermDays: '', creditLimit: '' });
  const convert = usePeopleMutation((body: Record<string, any>) => crmService.toCustomer(leadId, body), {
    invalidate: ['crm-leads', 'people-customers'],
    success: t('convertedToCustomer'),
    onSuccess: onClose,
  });
  const set = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'existing') return convert.mutate({ customerId: form.customerId });
    convert.mutate({
      code: form.code || undefined,
      nameAr: form.nameAr || undefined,
      nameEn: form.nameEn || undefined,
      taxId: form.taxId || undefined,
      paymentTermDays: form.paymentTermDays ? Number(form.paymentTermDays) : undefined,
      creditLimit: form.creditLimit ? Number(form.creditLimit) : undefined,
    });
  };
  return (
    <Modal isOpen onClose={onClose} title={t('convertToCustomer')}>
      <form onSubmit={submit} className="space-y-4">
        <Field label={t('conversionMode')}>
          <Select value={mode} onChange={(e) => setMode(e.target.value as 'new' | 'existing')} options={[{ value: 'new', label: t('createCustomer') }, { value: 'existing', label: t('linkExisting') }]} />
        </Field>
        {mode === 'existing' ? (
          <Field label={t('customer')} required>
            <Select required value={form.customerId} onChange={(e) => set('customerId', e.target.value)} placeholder="-" options={[...customerMap].map(([value, label]) => ({ value, label }))} />
          </Field>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <Field label={tc('code')} hint={t('codeGenerated')}>
              <Input value={form.code} onChange={(e) => set('code', e.target.value)} />
            </Field>
            <Field label={t('taxId')}>
              <Input value={form.taxId} onChange={(e) => set('taxId', e.target.value)} />
            </Field>
            <Field label={t('nameAr')}>
              <Input value={form.nameAr} onChange={(e) => set('nameAr', e.target.value)} />
            </Field>
            <Field label={t('nameEn')}>
              <Input value={form.nameEn} onChange={(e) => set('nameEn', e.target.value)} />
            </Field>
            <Field label={t('paymentTermDays')}>
              <Input type="number" min={0} value={form.paymentTermDays} onChange={(e) => set('paymentTermDays', e.target.value)} />
            </Field>
            <Field label={t('creditLimit')}>
              <Input type="number" min={0} step="any" value={form.creditLimit} onChange={(e) => set('creditLimit', e.target.value)} />
            </Field>
          </div>
        )}
        <FormActions onCancel={onClose} submitting={convert.isPending} submitLabel={t('convert')} />
      </form>
    </Modal>
  );
}

function QuotationDialog({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const t = useTranslations('crm');
  const tc = useTranslations('common');
  const tp = useTranslations('people');
  const { data: products } = useProducts();
  const { data: warehouses } = useWarehouses();
  const productMap = useLabelMap(products);
  const whMap = useLabelMap(warehouses);
  const [header, setHeader] = useState({ date: todayIso(), validityDate: '', warehouseId: '', notes: '' });
  const [lines, setLines] = useState([{ productId: '', quantity: '1', unitPrice: '', discount: '' }]);
  const create = usePeopleMutation((body: Record<string, any>) => crmService.quotation(leadId, body), {
    invalidate: ['crm-leads', 'sales-orders'],
    success: t('quotationCreated'),
    onSuccess: onClose,
  });
  const update = (i: number, patch: Partial<(typeof lines)[number]>) => setLines((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate({
      ...header,
      validityDate: header.validityDate || undefined,
      warehouseId: header.warehouseId || undefined,
      notes: header.notes || undefined,
      lines: lines.map((l) => ({
        productId: l.productId,
        quantity: Number(l.quantity),
        ...(l.unitPrice !== '' ? { unitPrice: Number(l.unitPrice) } : {}),
        ...(l.discount !== '' ? { discount: Number(l.discount) } : {}),
      })),
    });
  };
  return (
    <Modal isOpen onClose={onClose} title={t('createQuotation')} size="xl">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label={tc('date')}>
            <Input type="date" value={header.date} onChange={(e) => setHeader((h) => ({ ...h, date: e.target.value }))} />
          </Field>
          <Field label={t('validityDate')}>
            <Input type="date" value={header.validityDate} onChange={(e) => setHeader((h) => ({ ...h, validityDate: e.target.value }))} />
          </Field>
          <Field label={t('warehouse')}>
            <Select value={header.warehouseId} onChange={(e) => setHeader((h) => ({ ...h, warehouseId: e.target.value }))} placeholder={tp('none')} options={[...whMap].map(([value, label]) => ({ value, label }))} />
          </Field>
        </div>
        <div className="space-y-2">
          <div className="grid grid-cols-12 gap-2 text-xs text-gray-500">
            <span className="col-span-5">{t('product')}</span>
            <span className="col-span-2">{tc('quantity')}</span>
            <span className="col-span-2">{tc('price')}</span>
            <span className="col-span-2">{tc('discount')}</span>
          </div>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <Select className="col-span-5" required value={l.productId} onChange={(e) => update(i, { productId: e.target.value })} placeholder={tp('select')} options={[...productMap].map(([value, label]) => ({ value, label }))} />
              <Input className="col-span-2" type="number" step="any" min="0.0001" required value={l.quantity} onChange={(e) => update(i, { quantity: e.target.value })} />
              <Input className="col-span-2" type="number" step="any" min={0} placeholder={t('priceListDefault')} value={l.unitPrice} onChange={(e) => update(i, { unitPrice: e.target.value })} />
              <Input className="col-span-2" type="number" step="any" min={0} value={l.discount} onChange={(e) => update(i, { discount: e.target.value })} />
              <button type="button" className="col-span-1 text-red-600 text-sm hover:underline" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                {tp('remove')}
              </button>
            </div>
          ))}
          <Button variant="ghost" onClick={() => setLines((ls) => [...ls, { productId: '', quantity: '1', unitPrice: '', discount: '' }])}>
            + {tp('addLine')}
          </Button>
        </div>
        <Field label={tc('notes')}>
          <Input value={header.notes} onChange={(e) => setHeader((h) => ({ ...h, notes: e.target.value }))} />
        </Field>
        <FormActions onCancel={onClose} submitting={create.isPending} submitLabel={t('createQuotation')} />
      </form>
    </Modal>
  );
}

export default function LeadPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'new';
  const t = useTranslations('crm');
  const tc = useTranslations('common');
  const router = useRouter();
  const { data: lead } = usePeopleQuery(['crm-leads', id], () => crmService.lead(id), !isNew);
  const { data: activities = [] } = usePeopleQuery(['crm-activities', 'lead', id], () => crmService.activities({ leadId: id }), !isNew);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [reason, setReason] = useState('');
  const [tab, setTab] = useState<'details' | 'activities'>('details');

  const invalidate = ['crm-leads'];
  const save = usePeopleMutation((body: Record<string, any>) => (isNew ? crmService.createLead(body) : crmService.updateLead(id, body)), {
    invalidate,
    success: t('leadSaved'),
    onSuccess: (saved: any) => {
      if (isNew) router.replace(`/crm/leads/${saved.id}`);
    },
  });
  const won = usePeopleMutation(() => crmService.won(id), { invalidate, success: t('leadWon') });
  const lost = usePeopleMutation((r: string) => crmService.lost(id, r), { invalidate, success: t('leadLost'), onSuccess: () => setDialog(null) });
  const reopen = usePeopleMutation(() => crmService.reopen(id), { invalidate, success: t('leadReopened') });
  const toOpp = usePeopleMutation(() => crmService.toOpportunity(id), { invalidate, success: t('convertedToOpportunity') });
  const remove = usePeopleMutation(() => crmService.deleteLead(id), { invalidate, success: tc('deleteSuccess'), onSuccess: () => router.push('/crm/leads') });

  if (isNew) {
    return (
      <div>
        <PageHeader title={t('newLead')} />
        <Card>
          <LeadForm submitting={save.isPending} onSubmit={(body) => save.mutate(body)} onCancel={() => router.push('/crm/leads')} />
        </Card>
      </div>
    );
  }
  if (!lead) return <div className="text-gray-500">{tc('loading')}</div>;

  return (
    <div className="space-y-4">
      <PageHeader title={`${lead.leadNumber} - ${lead.title}`} />
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={COLORS[lead.status]} label={t(`status_${lead.status}`)} />
        <span className="text-sm text-gray-500">{t(`type_${lead.type}`)}</span>
        {lead.lostReason && lead.status === 'lost' && <span className="text-sm text-red-600">{t('lostReason')}: {lead.lostReason}</span>}
        {lead.salesOrderId && <span className="text-sm text-green-700">{t('hasQuotation')}</span>}
        <div className="flex-1" />
        {lead.status === 'open' && (
          <>
            <Button variant="success" onClick={() => won.mutate(undefined)} disabled={won.isPending}>{t('markWon')}</Button>
            <Button variant="danger" onClick={() => { setReason(''); setDialog('lost'); }}>{t('markLost')}</Button>
          </>
        )}
        {lead.status !== 'open' && (
          <Button variant="secondary" onClick={() => reopen.mutate(undefined)} disabled={reopen.isPending}>{t('reopen')}</Button>
        )}
        {lead.type === 'lead' && lead.status === 'open' && (
          <Button variant="secondary" onClick={() => toOpp.mutate(undefined)} disabled={toOpp.isPending}>{t('convertToOpportunity')}</Button>
        )}
        {!lead.customerId && lead.status !== 'lost' && (
          <Button variant="secondary" onClick={() => setDialog('customer')}>{t('convertToCustomer')}</Button>
        )}
        {lead.status !== 'lost' && !lead.salesOrderId && (
          <Button variant="secondary" onClick={() => setDialog('quotation')} title={!lead.customerId ? t('quotationCreatesCustomer') : undefined}>
            {t('createQuotation')}
          </Button>
        )}
        <Button variant="secondary" onClick={() => setDialog('activity')}>{t('scheduleActivity')}</Button>
        {!lead.salesOrderId && <Button variant="danger" onClick={() => setDialog('delete')}>{tc('delete')}</Button>}
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'details', label: t('details') },
          { key: 'activities', label: t('activities'), count: activities.filter((a) => a.status === 'planned').length },
        ]}
      />
      {tab === 'details' ? (
        <Card>
          <LeadForm lead={lead} submitting={save.isPending} onSubmit={(body) => save.mutate(body)} />
        </Card>
      ) : (
        <ActivityTable activities={activities} />
      )}

      <Modal isOpen={dialog === 'lost'} onClose={() => setDialog(null)} title={t('markLost')} size="sm">
        <form onSubmit={(e) => { e.preventDefault(); lost.mutate(reason); }} className="space-y-4">
          <Field label={t('lostReason')} required>
            <Input required value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <FormActions onCancel={() => setDialog(null)} submitting={lost.isPending} submitLabel={t('markLost')} />
        </form>
      </Modal>
      {dialog === 'customer' && <CustomerDialog leadId={id} defaultName={lead.companyName || lead.contactName || lead.title} onClose={() => setDialog(null)} />}
      {dialog === 'quotation' && <QuotationDialog leadId={id} onClose={() => setDialog(null)} />}
      <ActivityFormModal isOpen={dialog === 'activity'} onClose={() => setDialog(null)} leadId={id} />
      <ConfirmDialog isOpen={dialog === 'delete'} onClose={() => setDialog(null)} onConfirm={() => remove.mutate(undefined)} title={tc('delete')} message={tc('confirmDelete')} destructive loading={remove.isPending} />
    </div>
  );
}
