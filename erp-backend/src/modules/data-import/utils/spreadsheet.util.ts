import * as ExcelJS from 'exceljs';

/**
 * Spreadsheet helpers of the data-import module: parsing of .xlsx / .csv
 * uploads into typed rows (with row-level issues), and generation of the
 * bilingual templates, exports and error files.
 */

export type ColumnType = 'string' | 'number' | 'integer' | 'boolean' | 'date' | 'enum';

export interface BilingualText {
  en: string;
  ar: string;
}

export interface EnumValue {
  value: string;
  /** Other accepted spellings (Arabic labels, abbreviations). */
  aliases?: string[];
}

export interface ColumnSpec {
  /** Machine key, also accepted as header. */
  key: string;
  label: BilingualText;
  type?: ColumnType;
  required?: boolean;
  values?: EnumValue[];
  min?: number;
  max?: number;
  note?: BilingualText;
  example?: string | number | boolean;
  width?: number;
}

export type IssueSeverity = 'error' | 'warning';

export interface ImportIssue {
  /** Spreadsheet row number (1-based); 0 for file-level issues. */
  row: number;
  column?: string;
  severity: IssueSeverity;
  /** Stable machine code for translation (required, invalid_number, not_found...). */
  code: string;
  message: string;
}

export interface ParsedRow {
  rowNumber: number;
  /** Coerced values keyed by column key (empty cells are absent). */
  values: Record<string, unknown>;
  /** Cell text as uploaded, used to build the error file. */
  raw: Record<string, string>;
}

export interface ParseResult {
  rows: ParsedRow[];
  issues: ImportIssue[];
  headerRow: number;
  /** Column keys found in the file, in file order. */
  columns: string[];
}

type CellValue = string | number | boolean | Date | null;

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_ROWS = 20000;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export async function parseSpreadsheet(
  buffer: Buffer,
  fileName: string,
  columns: ColumnSpec[],
): Promise<ParseResult> {
  const isXlsx = /\.xlsx$/i.test(fileName) || (buffer.length > 1 && buffer[0] === 0x50 && buffer[1] === 0x4b);
  let matrices: CellValue[][][];
  if (isXlsx) {
    matrices = await readXlsx(buffer);
  } else {
    matrices = [parseCsv(buffer.toString('utf8'))];
  }
  return parseMatrices(matrices, columns);
}

/** Picks the first sheet with a recognisable header and converts its rows. */
export function parseMatrices(matrices: CellValue[][][], columns: ColumnSpec[]): ParseResult {
  let best: { matrix: CellValue[][]; headerIndex: number; mapping: (ColumnSpec | null)[]; score: number } | null =
    null;
  for (const matrix of matrices) {
    for (let i = 0; i < Math.min(matrix.length, 10); i++) {
      const mapping = (matrix[i] ?? []).map((cell) => matchHeader(cell, columns));
      const score = mapping.filter(Boolean).length;
      if (score > 0 && (!best || score > best.score)) best = { matrix, headerIndex: i, mapping, score };
    }
    if (best) break;
  }

  const issues: ImportIssue[] = [];
  if (!best) {
    issues.push({
      row: 0,
      severity: 'error',
      code: 'header_not_found',
      message: 'No header row with known columns was found; download the template',
    });
    return { rows: [], issues, headerRow: 0, columns: [] };
  }

  const { matrix, headerIndex, mapping } = best;
  const headerRow = headerIndex + 1;
  const seen = new Set<string>();
  (matrix[headerIndex] ?? []).forEach((cell, idx) => {
    const spec = mapping[idx];
    const text = cellText(cell);
    if (!spec) {
      if (text) {
        issues.push({
          row: headerRow,
          column: text,
          severity: 'warning',
          code: 'unknown_column',
          message: `Column "${text}" is not recognised and is ignored`,
        });
      }
      return;
    }
    if (seen.has(spec.key)) {
      issues.push({
        row: headerRow,
        column: spec.key,
        severity: 'error',
        code: 'duplicate_column',
        message: `Column "${spec.label.en}" appears more than once`,
      });
      mapping[idx] = null;
      return;
    }
    seen.add(spec.key);
  });
  for (const spec of columns) {
    if (spec.required && !seen.has(spec.key)) {
      issues.push({
        row: headerRow,
        column: spec.key,
        severity: 'error',
        code: 'missing_column',
        message: `Required column "${spec.label.en}" is missing`,
      });
    }
  }

  const rows: ParsedRow[] = [];
  for (let i = headerIndex + 1; i < matrix.length; i++) {
    const cells = matrix[i] ?? [];
    if (cells.every((c) => cellText(c) === '')) continue;
    if (rows.length >= MAX_ROWS) {
      issues.push({
        row: i + 1,
        severity: 'error',
        code: 'too_many_rows',
        message: `A file can hold at most ${MAX_ROWS} rows`,
      });
      break;
    }
    const rowNumber = i + 1;
    const row: ParsedRow = { rowNumber, values: {}, raw: {} };
    mapping.forEach((spec, idx) => {
      if (!spec) return;
      const cell = cells[idx] ?? null;
      row.raw[spec.key] = cellText(cell);
      const result = coerceCell(cell, spec);
      if (result.error) {
        issues.push({ row: rowNumber, column: spec.key, severity: 'error', ...result.error });
      } else if (result.value !== undefined) {
        row.values[spec.key] = result.value;
      }
    });
    for (const spec of columns) {
      if (spec.required && seen.has(spec.key) && row.values[spec.key] === undefined && !row.raw[spec.key]) {
        issues.push({
          row: rowNumber,
          column: spec.key,
          severity: 'error',
          code: 'required',
          message: `${spec.label.en} is required`,
        });
      }
    }
    rows.push(row);
  }

  if (rows.length === 0 && !issues.some((i) => i.severity === 'error')) {
    issues.push({ row: 0, severity: 'error', code: 'empty_file', message: 'The file has no data rows' });
  }
  return { rows, issues, headerRow, columns: mapping.filter(Boolean).map((s) => s!.key) };
}

async function readXlsx(buffer: Buffer): Promise<CellValue[][][]> {
  const workbook = new ExcelJS.Workbook();
  // exceljs typings expect an ArrayBuffer-like Buffer
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheets: CellValue[][][] = [];
  workbook.eachSheet((ws) => {
    const matrix: CellValue[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const cells: CellValue[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        cells[col - 1] = normalizeExcelValue(cell.value);
      });
      matrix[rowNumber - 1] = cells;
    });
    for (let i = 0; i < matrix.length; i++) if (!matrix[i]) matrix[i] = [];
    sheets.push(matrix);
  });
  return sheets;
}

function normalizeExcelValue(value: ExcelJS.CellValue): CellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value;
  const v = value as any;
  if (Array.isArray(v.richText)) return v.richText.map((t: { text: string }) => t.text).join('');
  if ('result' in v) return normalizeExcelValue(v.result);
  if ('text' in v) return String(v.text ?? '');
  if ('error' in v) return null;
  return String(value);
}

/** RFC 4180-ish CSV parser; detects `,`, `;` or tab delimiters and strips a BOM. */
export function parseCsv(text: string): CellValue[][] {
  const content = text.replace(/^﻿/, '');
  const firstLine = content.split(/\r?\n/, 1)[0] ?? '';
  const counts = [',', ';', '\t'].map((d) => ({ d, n: firstLine.split(d).length - 1 }));
  const delimiter = counts.sort((a, b) => b.n - a.n)[0].n > 0 ? counts[0].d : ',';

  const rows: CellValue[][] = [];
  let row: CellValue[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (inQuotes) {
      if (ch === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === '') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && content[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Headers and values
// ---------------------------------------------------------------------------

function normalizeHeader(text: string): string {
  return text
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function matchHeader(cell: CellValue, columns: ColumnSpec[]): ColumnSpec | null {
  const text = normalizeHeader(cellText(cell));
  if (!text) return null;
  const parts = [text, ...text.split(/\s*[/|]\s*/)].filter(Boolean);
  for (const spec of columns) {
    const names = [spec.key, spec.label.en, spec.label.ar].map(normalizeHeader);
    if (parts.some((p) => names.includes(p))) return spec;
  }
  return null;
}

export function headerText(spec: ColumnSpec): string {
  return `${spec.label.en} / ${spec.label.ar}${spec.required ? ' *' : ''}`;
}

function cellText(cell: CellValue | undefined): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) return isNaN(cell.getTime()) ? '' : cell.toISOString().slice(0, 10);
  return String(cell).trim();
}

const ARABIC_DIGITS = /[٠-٩۰-۹]/g;

/** Converts Arabic-Indic digits and separators to ASCII. */
export function normalizeDigits(text: string): string {
  return text
    .replace(ARABIC_DIGITS, (d) => {
      const code = d.charCodeAt(0);
      return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
    })
    .replace(/٫/g, '.')
    .replace(/٬/g, ',');
}

interface CoerceResult {
  value?: unknown;
  error?: { code: string; message: string };
}

const TRUE_WORDS = ['true', 'yes', 'y', '1', 'نعم', 'صح', 'صحيح', 'x'];
const FALSE_WORDS = ['false', 'no', 'n', '0', 'لا', 'خطأ'];

export function coerceCell(cell: CellValue, spec: ColumnSpec): CoerceResult {
  const type = spec.type ?? 'string';
  const text = cellText(cell);
  if (text === '' && !(typeof cell === 'number')) return {};
  const label = spec.label.en;

  switch (type) {
    case 'string': {
      if (typeof cell === 'number') {
        return { value: Number.isInteger(cell) ? cell.toFixed(0) : String(cell) };
      }
      return { value: text };
    }
    case 'number':
    case 'integer': {
      let n: number;
      if (typeof cell === 'number') {
        n = cell;
      } else {
        let s = normalizeDigits(text).replace(/[\s,]/g, '');
        let negative = false;
        if (/^\(.*\)$/.test(s)) {
          negative = true;
          s = s.slice(1, -1);
        }
        n = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s) ? Number(s) : NaN;
        if (negative) n = -n;
      }
      if (!Number.isFinite(n)) {
        return { error: { code: 'invalid_number', message: `${label}: "${text}" is not a number` } };
      }
      if (type === 'integer' && !Number.isInteger(n)) {
        return { error: { code: 'invalid_integer', message: `${label}: "${text}" must be a whole number` } };
      }
      if (spec.min !== undefined && n < spec.min) {
        return { error: { code: 'below_min', message: `${label} must be at least ${spec.min}` } };
      }
      if (spec.max !== undefined && n > spec.max) {
        return { error: { code: 'above_max', message: `${label} must be at most ${spec.max}` } };
      }
      return { value: n };
    }
    case 'boolean': {
      if (typeof cell === 'boolean') return { value: cell };
      const s = normalizeDigits(text).toLowerCase();
      if (TRUE_WORDS.includes(s)) return { value: true };
      if (FALSE_WORDS.includes(s)) return { value: false };
      return { error: { code: 'invalid_boolean', message: `${label}: "${text}" must be yes/no (نعم/لا)` } };
    }
    case 'date': {
      const iso = toIsoDate(cell);
      if (!iso) {
        return { error: { code: 'invalid_date', message: `${label}: "${text}" is not a date (YYYY-MM-DD)` } };
      }
      return { value: iso };
    }
    case 'enum': {
      const s = normalizeDigits(text).toLowerCase();
      for (const v of spec.values ?? []) {
        if ([v.value, ...(v.aliases ?? [])].some((a) => a.toLowerCase() === s)) return { value: v.value };
      }
      return {
        error: {
          code: 'invalid_value',
          message: `${label}: "${text}" is not one of ${(spec.values ?? []).map((v) => v.value).join(', ')}`,
        },
      };
    }
  }
  return {};
}

/** Accepts Date cells, Excel serial numbers, YYYY-MM-DD, YYYY/MM/DD and DD/MM/YYYY. */
export function toIsoDate(cell: CellValue): string | null {
  if (cell instanceof Date) return isNaN(cell.getTime()) ? null : cell.toISOString().slice(0, 10);
  if (typeof cell === 'number') {
    if (cell < 1 || cell > 2958465) return null;
    return new Date(Math.round((cell - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  const s = normalizeDigits(cellText(cell));
  let y: number, m: number, d: number;
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/.exec(s);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
    if (!match) return null;
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface SheetData {
  name: string;
  headers: string[];
  rows: unknown[][];
  widths?: number[];
  /** Highlight the header cells at these indexes (required columns). */
  requiredIndexes?: number[];
}

export async function buildWorkbook(sheets: SheetData[], rtl = true): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ERP';
  workbook.created = new Date();
  const font = { name: 'Arial', size: 11 };
  for (const sheet of sheets) {
    const ws = workbook.addWorksheet(sheet.name.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Sheet', {
      views: [{ rightToLeft: rtl, state: 'frozen', ySplit: 1 }],
    });
    const header = ws.addRow(sheet.headers);
    header.font = { ...font, bold: true };
    header.eachCell((cell, col) => {
      const required = sheet.requiredIndexes?.includes(col - 1);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: required ? 'FFFCE4D6' : 'FFE7EEF7' } };
      cell.border = { bottom: { style: 'thin' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });
    for (const values of sheet.rows) {
      ws.addRow(values.map((v) => (v === undefined ? null : v))).font = font;
    }
    sheet.headers.forEach((_, i) => {
      ws.getColumn(i + 1).width = sheet.widths?.[i] ?? 22;
    });
  }
  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

/** Template: an empty data sheet with bilingual headers plus an instructions sheet. */
export function templateSheets(title: BilingualText, columns: ColumnSpec[]): SheetData[] {
  return [
    {
      name: 'Data',
      headers: columns.map(headerText),
      rows: [],
      widths: columns.map((c) => c.width ?? 22),
      requiredIndexes: columns.map((c, i) => (c.required ? i : -1)).filter((i) => i >= 0),
    },
    {
      name: 'Instructions',
      headers: [
        'Column / العمود',
        'Required / إلزامي',
        'Type / النوع',
        'Allowed values / القيم المسموحة',
        'Notes',
        'ملاحظات',
        'Example / مثال',
      ],
      rows: [
        [`${title.en} / ${title.ar}`, '', '', '', 'Fill the "Data" sheet; one row per record.', 'املأ ورقة "Data"، صف لكل سجل.', ''],
        ...columns.map((c) => [
          headerText(c),
          c.required ? 'Yes / نعم' : 'No / لا',
          c.type ?? 'string',
          (c.values ?? []).map((v) => [v.value, ...(v.aliases ?? [])].join(' | ')).join(', '),
          c.note?.en ?? '',
          c.note?.ar ?? '',
          c.example ?? '',
        ]),
      ],
      widths: [34, 14, 10, 40, 50, 50, 18],
    },
  ];
}

/** Error file: the uploaded rows (with issues) followed by their errors and warnings. */
export function errorSheets(columns: ColumnSpec[], rows: ParsedRow[], issues: ImportIssue[]): SheetData[] {
  const byRow = new Map<number, ImportIssue[]>();
  for (const issue of issues) {
    const list = byRow.get(issue.row) ?? [];
    list.push(issue);
    byRow.set(issue.row, list);
  }
  const fileIssues = byRow.get(0) ?? [];
  const dataRows = rows
    .filter((r) => byRow.has(r.rowNumber))
    .map((r) => {
      const list = byRow.get(r.rowNumber) ?? [];
      return [
        r.rowNumber,
        list.filter((i) => i.severity === 'error').map((i) => i.message).join('\n'),
        list.filter((i) => i.severity === 'warning').map((i) => i.message).join('\n'),
        ...columns.map((c) => r.raw[c.key] ?? ''),
      ];
    });
  const rowNumbers = new Set(rows.map((r) => r.rowNumber));
  const headerIssues = issues.filter((i) => i.row > 0 && !rowNumbers.has(i.row));
  const general = [...fileIssues, ...headerIssues].map((i) => [
    i.row || '',
    i.severity === 'error' ? i.message : '',
    i.severity === 'warning' ? i.message : '',
    ...columns.map(() => ''),
  ]);
  return [
    {
      name: 'Errors',
      headers: ['Row / الصف', 'Errors / الأخطاء', 'Warnings / التنبيهات', ...columns.map(headerText)],
      rows: [...general, ...dataRows],
      widths: [10, 50, 40, ...columns.map((c) => c.width ?? 18)],
    },
  ];
}
