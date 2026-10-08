import { Injectable, StreamableFile } from '@nestjs/common';
import * as ExcelJS from 'exceljs';

export type ReportFormat = 'json' | 'xlsx';
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
   * Returns the report data as is (JSON) or, for `format=xlsx`, the Excel file
   * built from the spec.
   */
  async respond<T>(
    format: ReportFormat | undefined,
    lang: ReportLang | undefined,
    data: T,
    spec: (data: T) => ExportSpec,
  ): Promise<T | ExcelFile> {
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
