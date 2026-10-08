'use client';

import { useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { FileSpreadsheet, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { clsx } from 'clsx';
import { finReportsService } from '@/services/finance-reports.service';
import { openPdf } from '@/services/platform.service';
import { Btn, fmtDate, fmtMoney, fmtNum } from './ui';

export type ColType = 'text' | 'money' | 'number' | 'percent' | 'date';

export interface ReportColumn {
  key: string;
  label: string;
  type?: ColType;
  render?: (row: any) => ReactNode;
}

export interface ReportSection {
  title?: string;
  columns: ReportColumn[];
  rows: any[];
  totals?: Record<string, unknown>;
  /** Row style: bold group rows, indentation... */
  rowClass?: (row: any) => string | undefined;
  indent?: (row: any) => number;
}

function cell(value: unknown, type: ColType = 'text') {
  if (value === null || value === undefined || value === '') return '';
  switch (type) {
    case 'money':
      return fmtMoney(value);
    case 'number':
      return fmtNum(value);
    case 'percent':
      return Number.isFinite(Number(value)) ? `${Number(value).toFixed(2)}%` : String(value);
    case 'date':
      return fmtDate(value);
    default:
      return String(value);
  }
}

const numeric = (type?: ColType) => type === 'money' || type === 'number' || type === 'percent';

/** Read-only table for report data with typed columns and an optional totals row. */
export function ReportTable({ section }: { section: ReportSection }) {
  const tc = useTranslations('common');
  const { columns, rows, totals } = section;
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {section.title && <div className="px-4 py-2 border-b border-gray-200 font-semibold text-sm">{section.title}</div>}
      {rows.length === 0 ? (
        <div className="p-8 text-center text-sm text-gray-500">{tc('noData')}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className={clsx('px-3 py-2 font-medium text-gray-600 whitespace-nowrap', numeric(c.type) ? 'text-end' : 'text-start')}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.id ?? row.accountId ?? i} className={clsx('border-b border-gray-100 last:border-0', section.rowClass?.(row))}>
                  {columns.map((c, ci) => {
                    const v = row[c.key];
                    return (
                      <td
                        key={c.key}
                        className={clsx(
                          'px-3 py-1.5',
                          numeric(c.type) ? 'text-end tabular-nums whitespace-nowrap' : '',
                          numeric(c.type) && Number(v) < 0 && 'text-red-600',
                        )}
                        style={ci === 1 && section.indent ? { paddingInlineStart: `${0.75 + section.indent(row) * 1}rem` } : undefined}
                        dir={numeric(c.type) ? 'ltr' : undefined}
                      >
                        {c.render ? c.render(row) : cell(v, c.type)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            {totals && (
              <tfoot>
                <tr className="bg-gray-100 font-semibold border-t border-gray-300">
                  {columns.map((c, i) => (
                    <td
                      key={c.key}
                      className={clsx('px-3 py-2', numeric(c.type) ? 'text-end tabular-nums whitespace-nowrap' : '')}
                      dir={numeric(c.type) ? 'ltr' : undefined}
                    >
                      {i === 0 && totals[c.key] === undefined ? tc('total') : cell(totals[c.key], c.type)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}

/** Downloads the Excel version of a report in the current UI language. */
export function ExcelButton({ endpoint, params, disabled }: { endpoint: string; params: Record<string, unknown>; disabled?: boolean }) {
  const t = useTranslations('reports');
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  return (
    <Btn
      variant="success"
      disabled={busy || disabled}
      onClick={async () => {
        setBusy(true);
        try {
          await finReportsService.downloadXlsx(endpoint, params, locale);
        } catch {
          toast.error(t('downloadFailed'));
        } finally {
          setBusy(false);
        }
      }}
    >
      <FileSpreadsheet size={16} />
      {busy ? t('downloading') : t('excel')}
    </Btn>
  );
}

/** Opens the PDF version of a report (?format=pdf&lang=) in a new tab. */
export function PdfButton({ endpoint, params, disabled }: { endpoint: string; params: Record<string, unknown>; disabled?: boolean }) {
  const t = useTranslations('reports');
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  return (
    <Btn
      variant="secondary"
      disabled={busy || disabled}
      onClick={async () => {
        setBusy(true);
        try {
          const p: Record<string, any> = {};
          for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p[k] = v;
          await openPdf(`/reports/${endpoint}`, { ...p, format: 'pdf', lang: locale });
        } catch {
          toast.error(t('downloadFailed'));
        } finally {
          setBusy(false);
        }
      }}
    >
      <FileText size={16} />
      {busy ? t('downloading') : t('pdf')}
    </Btn>
  );
}
