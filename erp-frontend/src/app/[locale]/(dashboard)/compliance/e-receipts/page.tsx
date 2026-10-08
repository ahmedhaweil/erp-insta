'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { Btn, Field, inputCls } from '@/components/operations/form';
import { Card, fmtDateTime, fmtMoney, RowAction, RowActions, Status, useModal } from '@/components/operations/common';
import { ComplianceFilters, DocumentDetail, Pager, QrModal, useComplianceList } from '@/components/operations/compliance/ComplianceList';
import { useOpsMutation } from '@/hooks/use-operations';
import { opsCompliance } from '@/services/operations-compliance.service';
import type { Row } from '@/services/operations-api';

/** ETA e-receipts of POS orders. */
export default function EReceiptsPage() {
  const t = useTranslations('ops');
  const { filters, setFilters, query } = useComplianceList('e-receipts', opsCompliance.eReceipts);
  const detail = useModal<Row>();
  const [qr, setQr] = useState<any>(null);
  const [posOrderId, setPosOrderId] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const inv = ['e-receipts'];
  const refresh = useOpsMutation((id: string) => opsCompliance.refreshReceipt(id), { invalidate: inv, success: 'refreshed' });
  const loadQr = useOpsMutation((id: string) => opsCompliance.receiptQr(id), { success: false, onSuccess: (d) => setQr(d) });
  const doPreview = useOpsMutation(() => opsCompliance.previewReceipt(posOrderId.trim()), { success: false, onSuccess: (d) => setPreview(d) });
  const submit = useOpsMutation(() => opsCompliance.submitReceipt(posOrderId.trim()), {
    invalidate: inv,
    success: 'submitted',
    onSuccess: () => {
      setPreview(null);
      setPosOrderId('');
    },
  });

  return (
    <div className="space-y-4">
      <PageHeader title={t('comp.eReceipts')} />
      <Card title={t('comp.submitReceipt')}>
        <p className="text-sm text-gray-600 mb-3">{t('comp.submitReceiptHint')}</p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('comp.posOrderId')} className="flex-1 min-w-[280px]">
            <input value={posOrderId} onChange={(e) => setPosOrderId(e.target.value)} className={inputCls} />
          </Field>
          <Btn variant="secondary" disabled={!posOrderId.trim()} loading={doPreview.isPending} onClick={() => doPreview.mutate(undefined)}>{t('comp.preview')}</Btn>
          <Btn disabled={!posOrderId.trim()} loading={submit.isPending} onClick={() => submit.mutate(undefined)}>{t('comp.submit')}</Btn>
        </div>
        {preview && (
          <pre className="mt-4 max-h-96 overflow-auto bg-gray-900 text-gray-100 text-xs rounded-lg p-3" dir="ltr">
            {JSON.stringify(preview, null, 2)}
          </pre>
        )}
      </Card>
      <ComplianceFilters filters={filters} onChange={setFilters} showProvider={false} />
      <DataTable
        data={query.data?.items ?? []}
        loading={query.isLoading}
        pageSize={200}
        onRowClick={(d: Row) => detail.open(d)}
        columns={[
          { key: 'receiptNumber', header: t('common.number') },
          { key: 'dateTimeIssued', header: t('common.date'), render: (d: Row) => fmtDateTime(d.dateTimeIssued) },
          { key: 'receiptType', header: t('common.type') },
          { key: 'deviceSerial', header: t('comp.deviceSerial') },
          { key: 'totalAmount', header: t('common.total'), render: (d: Row) => fmtMoney(d.totalAmount) },
          { key: 'status', header: t('common.status'), render: (d: Row) => <Status status={d.status} /> },
        ]}
        actions={(d: Row) => (
          <RowActions>
            {['submitted', 'pending', 'failed', 'invalid'].includes(d.status) && <RowAction onClick={() => refresh.mutate(d.id)}>{t('common.refresh')}</RowAction>}
            {d.uuid && <RowAction tone="green" onClick={() => loadQr.mutate(d.id)}>{t('comp.qrPrint')}</RowAction>}
          </RowActions>
        )}
      />
      <Pager data={query.data} filters={filters} onChange={setFilters} />
      {detail.data && (
        <Modal isOpen onClose={detail.close} title={`${t('comp.eReceipt')} ${detail.data.receiptNumber}`} size="xl">
          <DocumentDetail
            doc={detail.data}
            extra={[
              { label: t('comp.deviceSerial'), value: detail.data.deviceSerial },
              { label: t('comp.previousUuid'), value: <span className="font-mono text-xs">{detail.data.previousUuid ?? '-'}</span> },
            ]}
          />
        </Modal>
      )}
      {qr && <QrModal data={qr} onClose={() => setQr(null)} />}
    </div>
  );
}
