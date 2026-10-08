'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Modal from '@/components/ui/Modal';
import { Btn, Field, inputCls, SelectBox } from '@/components/operations/form';
import { DetailGrid, FilterBar, fmtDateTime, fmtMoney, SimpleTable, Status } from '@/components/operations/common';
import type { ComplianceListParams, Paged } from '@/services/operations-compliance.service';
import type { Row } from '@/services/operations-api';
import { useOpsQuery } from '@/hooks/use-operations';

export const COMPLIANCE_STATUSES = ['pending', 'submitted', 'valid', 'invalid', 'cancelled', 'rejected', 'reported', 'cleared', 'failed'];

/** Server-side filtered and paginated list of e-invoices / e-receipts. */
export function useComplianceList(key: string, fetcher: (p: ComplianceListParams) => Promise<Paged<Row>>) {
  const [filters, setFilters] = useState<ComplianceListParams>({ page: 1, limit: 25, order: 'desc' });
  const query = useOpsQuery([key, filters], () => fetcher(filters));
  return { filters, setFilters, query };
}

export function ComplianceFilters({
  filters,
  onChange,
  showProvider = true,
}: {
  filters: ComplianceListParams;
  onChange: (f: ComplianceListParams) => void;
  showProvider?: boolean;
}) {
  const t = useTranslations('ops');
  const [search, setSearch] = useState(filters.search ?? '');
  const set = (patch: Partial<ComplianceListParams>) => onChange({ ...filters, ...patch, page: 1 });
  return (
    <FilterBar>
      {showProvider && (
        <Field label={t('comp.provider')}>
          <SelectBox value={filters.provider ?? ''} onChange={(v) => set({ provider: v || undefined })} emptyLabel={t('common.all')} options={[{ value: 'eta', label: 'ETA' }, { value: 'zatca', label: 'ZATCA' }]} />
        </Field>
      )}
      <Field label={t('common.status')}>
        <SelectBox value={filters.status ?? ''} onChange={(v) => set({ status: v || undefined })} emptyLabel={t('common.all')} options={COMPLIANCE_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) }))} />
      </Field>
      <Field label={t('common.from')}>
        <input type="date" value={filters.from ?? ''} onChange={(e) => set({ from: e.target.value || undefined })} className={inputCls} />
      </Field>
      <Field label={t('common.to')}>
        <input type="date" value={filters.to ?? ''} onChange={(e) => set({ to: e.target.value || undefined })} className={inputCls} />
      </Field>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          set({ search: search.trim() || undefined });
        }}
      >
        <Field label={t('common.search')}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} className={inputCls} placeholder={t('comp.searchHint')} />
        </Field>
        <Btn type="submit" variant="secondary">{t('common.search')}</Btn>
      </form>
    </FilterBar>
  );
}

export function Pager({ data, filters, onChange }: { data?: Paged<Row>; filters: ComplianceListParams; onChange: (f: ComplianceListParams) => void }) {
  const t = useTranslations('ops');
  if (!data) return null;
  return (
    <div className="flex items-center justify-between mt-3 text-sm text-gray-600">
      <span>
        {t('common.page')} {data.page} / {Math.max(1, data.totalPages)} ({data.total})
      </span>
      <div className="flex gap-2">
        <Btn size="sm" variant="secondary" disabled={data.page <= 1} onClick={() => onChange({ ...filters, page: data.page - 1 })}>{t('common.previous')}</Btn>
        <Btn size="sm" variant="secondary" disabled={data.page >= data.totalPages} onClick={() => onChange({ ...filters, page: data.page + 1 })}>{t('common.next')}</Btn>
      </div>
    </div>
  );
}

/** QR / print information of a submitted document. */
export function QrModal({ data, onClose }: { data: any; onClose: () => void }) {
  const t = useTranslations('ops');
  return (
    <Modal isOpen onClose={onClose} title={t('comp.qr')} size="lg">
      <div className="space-y-4">
        <DetailGrid
          items={[
            { label: t('comp.provider'), value: String(data.provider ?? '').toUpperCase() },
            { label: t('common.status'), value: <Status status={data.status} /> },
            { label: 'UUID', value: <span className="font-mono text-xs">{data.uuid ?? '-'}</span> },
          ]}
        />
        {data.printUrl && (
          <a href={data.printUrl} target="_blank" rel="noopener noreferrer" className="inline-block px-4 py-2 bg-primary-600 text-white rounded-lg text-sm">
            {t('comp.openPrintView')}
          </a>
        )}
        {data.qrFields?.length > 0 && (
          <SimpleTable
            rows={data.qrFields}
            columns={[
              { key: 'tag', header: t('comp.tag'), render: (f) => (t.has(`comp.qrTags.t${f.tag}`) ? t(`comp.qrTags.t${f.tag}`) : f.tag) },
              { key: 'value', header: t('comp.value'), render: (f) => <span className="font-mono text-xs break-all">{f.value}</span> },
            ]}
          />
        )}
        <Field label={t('comp.qrContent')} hint={t('comp.qrContentHint')}>
          <textarea readOnly rows={4} value={data.qrContent ?? ''} className={`${inputCls} font-mono text-xs`} onFocus={(e) => e.target.select()} />
        </Field>
      </div>
    </Modal>
  );
}

/** Messages returned by the tax authority. */
export function DocumentDetail({ doc, extra }: { doc: Row; extra?: { label: string; value: React.ReactNode }[] }) {
  const t = useTranslations('ops');
  const messages = [...(doc.validationErrors ?? []).map((m: any) => ({ ...m, kind: 'error' })), ...(doc.warnings ?? []).map((m: any) => ({ ...m, kind: 'warning' }))];
  return (
    <div className="space-y-4">
      <DetailGrid
        items={[
          ...(extra ?? []),
          { label: t('common.status'), value: <Status status={doc.status} /> },
          { label: t('common.total'), value: fmtMoney(doc.totalAmount) },
          { label: 'UUID', value: <span className="font-mono text-xs">{doc.uuid ?? '-'}</span> },
          { label: t('comp.submissionUuid'), value: <span className="font-mono text-xs">{doc.submissionUuid ?? '-'}</span> },
          { label: t('comp.submittedAt'), value: fmtDateTime(doc.submittedAt) },
          { label: t('comp.lastCheckedAt'), value: fmtDateTime(doc.lastCheckedAt) },
          { label: t('comp.attempts'), value: doc.attempts ?? 0 },
          { label: t('comp.cancelReason'), value: doc.cancelReason || '-' },
        ]}
      />
      {doc.lastError && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{doc.lastError}</div>}
      {messages.length > 0 && (
        <SimpleTable
          rows={messages}
          columns={[
            { key: 'kind', header: t('common.type'), render: (m) => (m.kind === 'error' ? t('comp.error') : t('comp.warning')) },
            { key: 'code', header: t('common.code'), render: (m) => m.code ?? '-' },
            { key: 'message', header: t('comp.message') },
            { key: 'path', header: t('comp.path'), render: (m) => m.path ?? m.target ?? '-' },
          ]}
        />
      )}
    </div>
  );
}
