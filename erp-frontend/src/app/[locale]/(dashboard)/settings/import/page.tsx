'use client';

import { useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { clsx } from 'clsx';
import { CheckCircle2, Download, FileSpreadsheet, Upload, XCircle, AlertTriangle } from 'lucide-react';
import DataTable from '@/components/ui/DataTable';
import AccountPicker from '@/components/finance/AccountPicker';
import { Btn, Card, Field, Spinner, Tabs, inputCls } from '@/components/finance/ui';
import { errorMessage, fmtDateTime, usePlatformMutation } from '@/components/platform/ui';
import { dataImportService, type ImportEntity, type ImportJob, type ImportReport } from '@/services/platform.service';

const OPENING: ImportEntity[] = ['opening_stock', 'opening_customer_balances', 'opening_supplier_balances'];
const todayIso = () => new Date().toISOString().slice(0, 10);

/** Import wizard (template → upload → validation report → commit) and master-data export. */
export default function DataImportPage() {
  const t = useTranslations('imp');
  const tp = useTranslations('platform');
  const locale = useLocale();
  const bi = (v?: { en: string; ar: string } | string | null) => (!v ? '' : typeof v === 'string' ? v : locale === 'ar' ? v.ar : v.en);
  const { data: catalog = [], isLoading } = useQuery({ queryKey: ['import-catalog'], queryFn: dataImportService.catalog, staleTime: 300_000 });
  const [tab, setTab] = useState<'import' | 'export' | 'history'>('import');
  const [entity, setEntity] = useState<ImportEntity | ''>('');
  const def = catalog.find((c) => c.entity === entity);
  const isOpening = !!entity && OPENING.includes(entity);
  const [options, setOptions] = useState({ updateExisting: true, createMissing: false, date: todayIso(), offsetAccountId: '' });
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [validating, setValidating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const jobs = useQuery({ queryKey: ['import-jobs'], queryFn: () => dataImportService.jobs({ limit: 100 }), enabled: tab === 'history' });

  const choose = (e: ImportEntity) => {
    setEntity(e);
    setReport(null);
    setFile(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const download = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      toast.error(errorMessage(err, t('downloadFailed')));
    } finally {
      setBusy(null);
    }
  };

  const validate = async () => {
    if (!entity || !file) return;
    setValidating(true);
    setReport(null);
    try {
      const r = await dataImportService.validate(entity, file, {
        updateExisting: options.updateExisting,
        createMissing: options.createMissing,
        date: isOpening ? options.date : undefined,
        offsetAccountId: isOpening && options.offsetAccountId ? options.offsetAccountId : undefined,
      });
      setReport(r);
    } catch (err) {
      toast.error(errorMessage(err, tp('common.failed')));
    } finally {
      setValidating(false);
    }
  };

  const commit = usePlatformMutation(() => dataImportService.commit(report!.job.id), {
    invalidate: ['import-jobs'],
    success: t('imported'),
    onSuccess: (r) => setReport(r),
  });

  const job = report?.job;
  const canCommit = job?.status === 'validated' && job.errorRows === 0;

  const jobColumns = [
    { key: 'createdAt', header: tp('common.date'), render: (j: ImportJob) => fmtDateTime(j.createdAt) },
    { key: 'entity', header: t('entity'), render: (j: ImportJob) => bi(catalog.find((c) => c.entity === j.entity)?.title) || j.entity },
    { key: 'fileName', header: t('file') },
    { key: 'totalRows', header: t('rows') },
    { key: 'errorRows', header: t('errors') },
    { key: 'createCount', header: t('created') },
    { key: 'updateCount', header: t('updated') },
    { key: 'status', header: tp('common.status'), render: (j: ImportJob) => t(`jobStatus.${j.status}`) },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
        <p className="text-sm text-gray-500">{t('intro')}</p>
      </div>
      <Tabs
        tabs={[
          { key: 'import', label: t('importTab') },
          { key: 'export', label: t('exportTab') },
          { key: 'history', label: t('historyTab') },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'import' && (
        <>
          <Card title={t('step1')}>
            {isLoading ? (
              <Spinner />
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {catalog.map((c) => (
                  <button
                    key={c.entity}
                    type="button"
                    onClick={() => choose(c.entity)}
                    className={clsx(
                      'p-4 rounded-xl border-2 text-start transition',
                      entity === c.entity ? 'border-primary-600 bg-primary-50' : 'border-gray-200 hover:bg-gray-50',
                    )}
                  >
                    <FileSpreadsheet size={18} className="text-primary-600 mb-1" />
                    <div className="font-semibold text-sm">{bi(c.title)}</div>
                    <div className="text-xs text-gray-500">{t('columnsCount', { n: c.columns.length })}</div>
                  </button>
                ))}
              </div>
            )}
          </Card>

          {def && (
            <Card
              title={t('step2')}
              actions={
                <div className="flex gap-2">
                  {(['ar', 'en'] as const).map((lang) => (
                    <Btn
                      key={lang}
                      size="sm"
                      variant="secondary"
                      disabled={busy === `tpl-${lang}`}
                      onClick={() => download(`tpl-${lang}`, () => dataImportService.downloadTemplate(def.entity, lang))}
                    >
                      <Download size={14} /> {t(`template_${lang}`)}
                    </Btn>
                  ))}
                </div>
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="text-start px-3 py-2">{t('column')}</th>
                      <th className="text-start px-3 py-2">{t('header')}</th>
                      <th className="text-start px-3 py-2">{tp('common.type')}</th>
                      <th className="text-start px-3 py-2">{t('notes')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {def.columns.map((c) => (
                      <tr key={c.key} className="border-t border-gray-100">
                        <td className="px-3 py-1.5">
                          {bi(c.label)}
                          {c.required && <span className="text-red-500 ms-0.5">*</span>}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-xs" dir="ltr">
                          {c.key}
                        </td>
                        <td className="px-3 py-1.5">{t.has(`type.${c.type}`) ? t(`type.${c.type}`) : c.type}</td>
                        <td className="px-3 py-1.5 text-xs text-gray-600">
                          {c.values?.length ? <span dir="ltr">{c.values.join(' | ')}</span> : null} {bi(c.note as any)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {def && (
            <Card title={t('step3')}>
              <div className="flex flex-wrap items-end gap-4">
                <Field label={t('file') + ' *'} hint={t('fileHint')}>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".xlsx,.csv"
                    className={inputCls}
                    onChange={(e) => {
                      setFile(e.target.files?.[0] ?? null);
                      setReport(null);
                    }}
                  />
                </Field>
                {!isOpening && (
                  <label className="flex items-center gap-2 text-sm pb-2">
                    <input type="checkbox" checked={options.updateExisting} onChange={(e) => setOptions({ ...options, updateExisting: e.target.checked })} />
                    {t('updateExisting')}
                  </label>
                )}
                {def.entity === 'products' && (
                  <label className="flex items-center gap-2 text-sm pb-2">
                    <input type="checkbox" checked={options.createMissing} onChange={(e) => setOptions({ ...options, createMissing: e.target.checked })} />
                    {t('createMissing')}
                  </label>
                )}
                {isOpening && (
                  <>
                    <Field label={t('openingDate')}>
                      <input type="date" className={inputCls} value={options.date} onChange={(e) => setOptions({ ...options, date: e.target.value })} />
                    </Field>
                    <Field label={t('offsetAccount')} hint={t('offsetAccountHint')} className="w-72">
                      <AccountPicker value={options.offsetAccountId} onChange={(id) => setOptions({ ...options, offsetAccountId: id })} />
                    </Field>
                  </>
                )}
                <Btn disabled={!file || validating} onClick={validate}>
                  <Upload size={14} /> {validating ? tp('common.loading') : t('validate')}
                </Btn>
              </div>
            </Card>
          )}

          {job && (
            <Card
              title={t('step4')}
              actions={
                <div className="flex gap-2">
                  {(job.errorRows > 0 || job.warningRows > 0) && (
                    <Btn size="sm" variant="secondary" disabled={busy === 'errors'} onClick={() => download('errors', () => dataImportService.downloadErrors(job.id, locale))}>
                      <Download size={14} /> {t('errorFile')}
                    </Btn>
                  )}
                  {job.status !== 'committed' && (
                    <Btn size="sm" variant="success" disabled={!canCommit || commit.isPending} onClick={() => commit.mutate(undefined)}>
                      {t('commit')}
                    </Btn>
                  )}
                </div>
              }
            >
              <div
                className={clsx(
                  'flex items-center gap-2 rounded-lg px-3 py-2 text-sm mb-3',
                  job.status === 'committed' ? 'bg-green-50 text-green-800' : job.errorRows ? 'bg-red-50 text-red-800' : 'bg-blue-50 text-blue-800',
                )}
              >
                {job.status === 'committed' ? <CheckCircle2 size={16} /> : job.errorRows ? <XCircle size={16} /> : <AlertTriangle size={16} />}
                {job.status === 'committed' ? t('committedMsg') : job.errorRows ? t('hasErrors') : t('readyToCommit')}
              </div>
              <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-4 text-center">
                {(
                  [
                    ['rows', job.totalRows],
                    ['errors', job.errorRows],
                    ['warnings', job.warningRows],
                    ['toCreate', job.createCount],
                    ['toUpdate', job.updateCount],
                    ['toSkip', job.skipCount],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="bg-gray-50 rounded-lg p-2">
                    <div className="text-xs text-gray-500">{t(k)}</div>
                    <div className={clsx('text-lg font-bold', k === 'errors' && v ? 'text-red-600' : k === 'warnings' && v ? 'text-amber-600' : '')}>{v}</div>
                  </div>
                ))}
              </div>
              {report?.summary && Object.keys(report.summary).length > 0 && (
                <div className="text-sm text-gray-700 mb-3 flex flex-wrap gap-4">
                  {Object.entries(report.summary).map(([k, v]) => (
                    <span key={k}>
                      {t.has(`summary.${k}`) ? t(`summary.${k}`) : k}: <b dir="ltr">{typeof v === 'number' ? v.toLocaleString('en-US') : String(v ?? '-')}</b>
                    </span>
                  ))}
                </div>
              )}
              {job.issues?.length > 0 && (
                <div className="overflow-x-auto max-h-96 border border-gray-200 rounded-lg">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="text-start px-3 py-2">{t('row')}</th>
                        <th className="text-start px-3 py-2">{t('column')}</th>
                        <th className="text-start px-3 py-2">{t('severity')}</th>
                        <th className="text-start px-3 py-2">{t('message')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {job.issues.slice(0, 500).map((i, idx) => (
                        <tr key={idx} className="border-t border-gray-100">
                          <td className="px-3 py-1.5">{i.row || '-'}</td>
                          <td className="px-3 py-1.5 font-mono text-xs" dir="ltr">
                            {i.column ?? ''}
                          </td>
                          <td className="px-3 py-1.5">
                            <span className={i.severity === 'error' ? 'text-red-600' : 'text-amber-600'}>{t(`sev.${i.severity}`)}</span>
                          </td>
                          <td className="px-3 py-1.5">{t.has(`issue.${i.code}`) ? `${t(`issue.${i.code}`)} — ${i.message}` : i.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {job.status === 'committed' && job.result && (
                <pre className="text-xs bg-gray-50 rounded-lg p-3 mt-3 overflow-x-auto" dir="ltr">
                  {JSON.stringify(job.result, null, 2)}
                </pre>
              )}
            </Card>
          )}
        </>
      )}

      {tab === 'export' && (
        <Card title={t('exportTitle')}>
          <p className="text-sm text-gray-500 mb-3">{t('exportIntro')}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {catalog
              .filter((c) => c.exportable)
              .map((c) => (
                <div key={c.entity} className="flex items-center justify-between border border-gray-200 rounded-lg px-4 py-3">
                  <span className="font-medium text-sm">{bi(c.title)}</span>
                  <div className="flex gap-2">
                    {(['ar', 'en'] as const).map((lang) => (
                      <Btn
                        key={lang}
                        size="sm"
                        variant="secondary"
                        disabled={busy === `exp-${c.entity}-${lang}`}
                        onClick={() => download(`exp-${c.entity}-${lang}`, () => dataImportService.exportData(c.entity, lang))}
                      >
                        <Download size={14} /> {t(`excel_${lang}`)}
                      </Btn>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        </Card>
      )}

      {tab === 'history' && (
        <DataTable
          columns={jobColumns}
          data={jobs.data ?? []}
          loading={jobs.isLoading}
          pageSize={20}
          actions={(j) =>
            j.errorRows > 0 || j.warningRows > 0 ? (
              <Btn size="sm" variant="ghost" onClick={() => download(`err-${j.id}`, () => dataImportService.downloadErrors(j.id, locale))}>
                {t('errorFile')}
              </Btn>
            ) : null
          }
        />
      )}
    </div>
  );
}
