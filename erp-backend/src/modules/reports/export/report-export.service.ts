import { Injectable, StreamableFile } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { renderA4 } from '@modules/printing/templates/a4-renderer';
import { CompanyHeader, PrintDocument } from '@modules/printing/templates/document.model';
import { PdfFile } from '@modules/printing/pdf-file';

export type ReportFormat = 'json' | 'xlsx' | 'pdf';
export type ReportLang = 'ar' | 'en';

export interface Label {
  en: string;
  ar: string;
}

export interface ExportColumn {
  key: string;
  label: Label;
  type?: 'text' | 'number' | 'money' | 'percent' | 'date';
  width?: number;
}

export interface ExportSheet {
  name: Label;
  columns: ExportColumn[];
  rows: Record<string, unknown>[];
  /** Optional totals row (same keys as the columns). */
  totals?: Record<string, unknown>;
}

export interface ExportSpec {
  title: Label;
  /** File name without extension (ASCII). */
  filename: string;
  /** Filter / header lines printed above the table. */
  meta?: { label: Label; value: unknown }[];
  sheets: ExportSheet[];
}

/**
 * A streamable Excel file that passes the global ResponseInterceptor
 * untouched: that interceptor leaves objects with a `success` key as they are,
 * so Nest's Express adapter streams the file instead of serialising it.
 */
export class ExcelFile extends StreamableFile {
  readonly success = true;
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MONEY_FMT = '#,##0.00;[Red]-#,##0.00';

/** Common labels reused by the report column definitions. */
export const L = {
  date: { en: 'Date', ar: 'التاريخ' },
  code: { en: 'Code', ar: 'الكود' },
  account: { en: 'Account', ar: 'الحساب' },
  name: { en: 'Name', ar: 'الاسم' },
  description: { en: 'Description', ar: 'البيان' },
  reference: { en: 'Reference', ar: 'المرجع' },
  debit: { en: 'Debit', ar: 'مدين' },
  credit: { en: 'Credit', ar: 'دائن' },
  balance: { en: 'Balance', ar: 'الرصيد' },
  from: { en: 'From', ar: 'من' },
  to: { en: 'To', ar: 'إلى' },
  total: { en: 'Total', ar: 'الإجمالي' },
  quantity: { en: 'Quantity', ar: 'الكمية' },
  net: { en: 'Net amount', ar: 'الصافي' },
  tax: { en: 'Tax', ar: 'الضريبة' },
  cost: { en: 'Cost', ar: 'التكلفة' },
  grossProfit: { en: 'Gross profit', ar: 'مجمل الربح' },
  margin: { en: 'Margin %', ar: 'نسبة الربح %' },
  count: { en: 'Documents', ar: 'عدد المستندات' },
} satisfies Record<string, Label>;

@Injectable()
export class ReportExportService {
  /**
   * Returns the report data as is (JSON) or, for `format=xlsx` / `format=pdf`,
   * the Excel / PDF file built from the spec. `company` (optional) is printed
   * as the PDF letterhead.
   */
  async respond<T>(
    format: ReportFormat | undefined,
    lang: ReportLang | undefined,
    data: T,
    spec: (data: T) => ExportSpec,
    company?: CompanyHeader,
  ): Promise<T | ExcelFile | PdfFile> {
    if (format === 'pdf') {
      const exportSpec = spec(data);
      const buffer = await this.toPdf(exportSpec, lang ?? 'ar', company);
      return new PdfFile(buffer, exportSpec.filename, 'attachment');
    }
    if (format !== 'xlsx') return data;
    const exportSpec = spec(data);
    const buffer = await this.toXlsx(exportSpec, lang ?? 'ar');
    return new ExcelFile(buffer, {
      type: XLSX_MIME,
      disposition: `attachment; filename="${exportSpec.filename}.xlsx"`,
      length: buffer.length,
    });
  }

  async toXlsx(spec: ExportSpec, lang: ReportLang = 'ar'): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'ERP';
    workbook.created = new Date();
    const rtl = lang === 'ar';
    const font = { name: 'Arial', size: 11 };
    const used = new Set<string>();

    for (const sheet of spec.sheets) {
      let name = this.sheetName(sheet.name[lang]);
      for (let i = 2; used.has(name.toLowerCase()); i++) name = `${name.slice(0, 27)} (${i})`;
      used.add(name.toLowerCase());
      const ws = workbook.addWorksheet(name, {
        views: [{ rightToLeft: rtl, state: 'frozen', ySplit: 0 }],
      });
      const width = Math.max(sheet.columns.length, 1);

      const title = ws.addRow([spec.title[lang]]);
      title.font = { ...font, size: 14, bold: true };
      ws.mergeCells(title.number, 1, title.number, width);
      if (spec.sheets.length > 1) {
        const sub = ws.addRow([sheet.name[lang]]);
        sub.font = { ...font, bold: true };
        ws.mergeCells(sub.number, 1, sub.number, width);
      }
      for (const m of spec.meta ?? []) {
        if (m.value === undefined || m.value === null || m.value === '') continue;
        const row = ws.addRow([m.label[lang], String(m.value)]);
        row.font = font;
      }
      ws.addRow([]);

      const header = ws.addRow(sheet.columns.map((c) => c.label[lang]));
      header.font = { ...font, bold: true };
      header.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7EEF7' } };
        cell.border = { bottom: { style: 'thin' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      });
      ws.views = [{ rightToLeft: rtl, state: 'frozen', ySplit: header.number }];

      for (const record of sheet.rows) {
        const row = ws.addRow(sheet.columns.map((c) => this.cellValue(record[c.key], c)));
        row.font = font;
      }
      if (sheet.totals) {
        const row = ws.addRow(sheet.columns.map((c) => this.cellValue(sheet.totals![c.key], c)));
        row.font = { ...font, bold: true };
        row.eachCell((cell) => (cell.border = { top: { style: 'thin' } }));
      }

      sheet.columns.forEach((c, i) => {
        const col = ws.getColumn(i + 1);
        col.width = c.width ?? (c.type === 'money' || c.type === 'number' ? 16 : c.type === 'date' ? 12 : 28);
        if (c.type === 'money') col.numFmt = MONEY_FMT;
        if (c.type === 'number') col.numFmt = '#,##0.####';
        if (c.type === 'percent') col.numFmt = '0.00';
        col.alignment = { readingOrder: rtl ? 'rtl' : 'ltr' };
      });
    }

    if (spec.sheets.length === 0) workbook.addWorksheet('Report');
    const out = await workbook.xlsx.writeBuffer();
    return Buffer.from(out as ArrayBuffer);
  }

  /**
   * PDF version of a report (A4, landscape when the table is wide), Arabic
   * shaped and right-to-left for lang=ar.
   */
  async toPdf(spec: ExportSpec, lang: ReportLang = 'ar', company?: CompanyHeader): Promise<Buffer> {
    const wide = spec.sheets.some((s) => s.columns.length > 7);
    const formatOf = (c: ExportColumn) =>
      c.type === 'money' ? 'money' : c.type === 'number' ? 'qty' : c.type === 'percent' ? 'percent' : 'text';
    const text = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v);
    const doc: PrintDocument = {
      lang,
      paper: wide ? 'a4-landscape' : 'a4',
      title: spec.title[lang],
      company: company ?? { name: '' },
      meta: (spec.meta ?? [])
        .filter((m) => m.value !== undefined && m.value !== null && m.value !== '')
        .map((m) => ({ label: m.label[lang], value: String(text(m.value)) })),
      tables: spec.sheets.map((sheet) => ({
        title: spec.sheets.length > 1 ? sheet.name[lang] : undefined,
        columns: sheet.columns.map((c) => ({
          key: c.key,
          label: c.label[lang],
          width: c.width ?? (c.type === 'money' || c.type === 'number' ? 14 : c.type === 'date' ? 11 : 24),
          format: formatOf(c),
          align: c.type === 'date' ? 'center' : undefined,
        })),
        rows: sheet.rows.map((r) =>
          Object.fromEntries(Object.entries(r).map(([k, v]) => [k, text(v)])),
        ),
        footer: sheet.totals,
      })),
      filename: spec.filename,
    };
    return renderA4(doc);
  }

  private cellValue(value: unknown, column: ExportColumn): unknown {
    if (value === undefined || value === null) return null;
    if (column.type === 'money' || column.type === 'number' || column.type === 'percent') {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value);
  }

  /** Excel sheet names: max 31 chars, no []:*?/\ characters. */
  private sheetName(name: string): string {
    return name.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Sheet';
  }
}
