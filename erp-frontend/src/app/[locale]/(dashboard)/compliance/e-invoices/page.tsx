'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { Btn, Field, SelectBox } from '@/components/operations/form';
import { Card, fmtDate, fmtMoney, PromptModal, RowAction, RowActions, Status, useModal } from '@/components/operations/common';
import { ComplianceFilters, DocumentDetail, Pager, QrModal, useComplianceList } from '@/components/operations/compliance/ComplianceList';
import { useOpsMutation, useOpsQuery } from '@/hooks/use-operations';
import { opsCompliance } from '@/services/operations-compliance.service';
import { opsSales } from '@/services/operations-sales.service';
import { opsPurchasing } from '@/services/operations-purchasing.service';
import type { Row } from '@/services/operations-api';

/** E-invoices sent to ETA (Egypt) or ZATCA (Saudi Arabia): submit, preview, refresh, cancel, QR / print. */
export default function EInvoicesPage() {
  const t = useTranslations('ops');
  const { filters, setFilters, query } = useComplianceList('e-invoices', opsCompliance.eInvoices);
  const detail = useModal<Row>();
  const cancel = useModal<Row>();
  const [qr, setQr] = useState<any>(null);
  const inv = ['e-invoices'];
  const refresh = useOpsMutation((id: string) => opsCompliance.refreshInvoice(id), { invalidate: inv, success: 'refreshed' });
  const refreshPending = useOpsMutation(() => opsCompliance.refreshPending(), { invalidate: inv, success: 'refreshed' });
  const doCancel = useOpsMutation((a: { id: string; reason: string }) => opsCompliance.cancelInvoice(a.id, a.reason), {
    invalidate: inv,
    success: 'cancelled',
    onSuccess: () => cancel.close(),
  });
  const loadQr = useOpsMutation((id: string) => opsCompliance.invoiceQr(id), { success: false, onSuccess: (d) => setQr(d) });

  return (
    <div className="space-y-4">
      <PageHeader title={t('comp.eInvoices')} />
      <SubmitPanel />
      <div className="flex justify-end">
        <Btn variant="secondary" loading={refreshPending.isPending} onClick={() => refreshPending.mutate(undefined)}>
          {t('comp.refreshPending')}
        </Btn>
      </div>
      <ComplianceFilters filters={filters} onChange={setFilters} />
      <DataTable
        data={query.data?.items ?? []}
        loading={query.isLoading}
        pageSize={200}
        onRowClick={(d: Row) => detail.open(d)}
        columns={[
          { key: 'internalId', header: t('common.number') },
          { key: 'documentDate', header: t('common.date'), render: (d: Row) => fmtDate(d.documentDate) },
          { key: 'provider', header: t('comp.provider'), render: (d: Row) => String(d.provider).toUpperCase() },
          { key: 'invoiceType', header: t('common.type'), render: (d: Row) => `${t(`comp.invoiceTypes.${d.invoiceType}`)} ${d.documentType ?? ''}` },
          { key: 'totalAmount', header: t('common.total'), render: (d: Row) => fmtMoney(d.totalAmount) },
          { key: 'status', header: t('common.status'), render: (d: Row) => <Status status={d.status} /> },
          { key: 'uuid', header: 'UUID', render: (d: Row) => <span className="font-mono text-xs">{d.uuid ? `${String(d.uuid).slice(0, 12)}…` : '-'}</span> },
        ]}
        actions={(d: Row) => (
          <RowActions>
            {['submitted', 'pending', 'failed', 'valid', 'invalid'].includes(d.status) && (
              <RowAction onClick={() => refresh.mutate(d.id)}>{t('common.refresh')}</RowAction>
            )}
            {d.uuid && <RowAction tone="green" onClick={() => loadQr.mutate(d.id)}>{t('comp.qrPrint')}</RowAction>}
            {d.provider === 'eta' && d.status === 'valid' && (
              <RowAction tone="red" onClick={() => cancel.open(d)}>{t('common.cancel')}</RowAction>
            )}
          </RowActions>
        )}
      />
      <Pager data={query.data} filters={filters} onChange={setFilters} />

      {detail.data && (
        <Modal isOpen onClose={detail.close} title={`${t('comp.eInvoice')} ${detail.data.internalId}`} size="xl">
          <DocumentDetail
            doc={detail.data}
            extra={[
              { label: t('comp.provider'), value: String(detail.data.provider).toUpperCase() },
              { label: t('comp.documentType'), value: `${detail.data.documentType ?? ''} ${detail.data.documentSubtype ?? ''}` },
              { label: 'Long ID', value: <span className="font-mono text-xs break-all">{detail.data.longId ?? '-'}</span> },
            ]}
          />
        </Modal>
      )}
      <PromptModal
        isOpen={cancel.isOpen}
        title={t('comp.cancelDocument')}
        label={t('common.reason')}
        loading={doCancel.isPending}
        onClose={cancel.close}
        onSubmit={(reason) => cancel.data && doCancel.mutate({ id: cancel.data.id, reason })}
      />
      {qr && <QrModal data={qr} onClose={() => setQr(null)} />}
    </div>
  );
}

/** Pick a posted invoice / credit note (or vendor bill), preview the payload and submit it. */
function SubmitPanel() {
  const t = useTranslations('ops');
  const [type, setType] = useState<'sales' | 'purchase'>('sales');
  const [invoiceId, setInvoiceId] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const sales = useOpsQuery(['sales-invoices'], opsSales.invoices, { enabled: type === 'sales' });
  const bills = useOpsQuery(['bills'], opsPurchasing.bills, { enabled: type === 'purchase' });
  const docs = (type === 'sales' ? sales.data : bills.data) ?? [];
  const eligible = docs.filter((d) => !['draft', 'cancelled'].includes(d.status));
  const doPreview = useOpsMutation(() => opsCompliance.previewInvoice(invoiceId), { success: false, onSuccess: (d) => setPreview(d) });
  const submit = useOpsMutation(() => opsCompliance.submitInvoice(invoiceId, type), {
    invalidate: ['e-invoices'],
    success: false,
    onSuccess: (doc: any) => {
      setPreview(null);
      if (['valid', 'reported', 'cleared', 'submitted'].includes(doc?.status)) toast.success(t('msg.submitted'));
      else toast.warning(`${t('comp.submissionResult')}: ${t.has(`status.${doc?.status}`) ? t(`status.${doc?.status}`) : doc?.status}`);
    },
  });
  return (
    <Card title={t('comp.submitDocument')}>
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('common.type')}>
          <SelectBox
            value={type}
            onChange={(v) => { setType(v as 'sales' | 'purchase'); setInvoiceId(''); setPreview(null); }}
            emptyLabel={false}
            options={[{ value: 'sales', label: t('comp.invoiceTypes.sales') }, { value: 'purchase', label: t('comp.invoiceTypes.purchase') }]}
          />
        </Field>
        <Field label={t('comp.document')} className="min-w-[260px]">
          <SelectBox
            value={invoiceId}
            onChange={(v) => { setInvoiceId(v); setPreview(null); }}
            options={eligible.map((d) => ({ value: d.id, label: `${d.invoiceNumber} - ${fmtDate(d.date)} - ${fmtMoney(d.totalAmount)}` }))}
          />
        </Field>
        <Btn variant="secondary" disabled={!invoiceId || type !== 'sales'} loading={doPreview.isPending} onClick={() => doPreview.mutate(undefined)}>
          {t('comp.preview')}
        </Btn>
        <Btn disabled={!invoiceId} loading={submit.isPending} onClick={() => submit.mutate(undefined)}>{t('comp.submit')}</Btn>
      </div>
      {preview && (
        <pre className="mt-4 max-h-96 overflow-auto bg-gray-900 text-gray-100 text-xs rounded-lg p-3" dir="ltr">
          {typeof preview === 'string' ? preview : JSON.stringify(preview, null, 2)}
        </pre>
      )}
    </Card>
  );
}
