/**
 * Data-driven description of a printable document. Builders map business
 * records to this model; the renderers (A4, 80mm receipt) know nothing about
 * invoices or payslips. Adding a document = writing one small builder.
 */

export type PrintLang = 'ar' | 'en';
export type Paper = 'a4' | 'a4-landscape' | '80mm';

export interface Field {
  label: string;
  value: unknown;
  /** Emphasised (bold) row, e.g. the grand total. */
  bold?: boolean;
}

export interface PartyBlock {
  title: string;
  fields: Field[];
}

export type ColumnFormat = 'text' | 'money' | 'qty' | 'percent' | 'index';

export interface Column {
  key: string;
  label: string;
  /** Relative width weight. */
  width: number;
  align?: 'start' | 'end' | 'center';
  format?: ColumnFormat;
}

export interface TableBlock {
  title?: string;
  columns: Column[];
  rows: Record<string, unknown>[];
  /** Optional totals row (same keys as the columns). */
  footer?: Record<string, unknown>;
  /**
   * Compact rendering on narrow (80mm) paper: `title` key on its own line,
   * `detail` keys joined on a second line and `amount` aligned to the end.
   * Without it each row is printed as label/value pairs.
   */
  compact?: { title: string; detail?: string[]; amount?: string };
}

export interface CompanyHeader {
  name: string;
  taxId?: string | null;
  commercialRegistration?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  branch?: string | null;
}

export interface PrintDocument {
  lang: PrintLang;
  paper: Paper;
  /** Main title, e.g. "فاتورة ضريبية". */
  title: string;
  /** Secondary title, e.g. the title in the other language. */
  subtitle?: string;
  /** Document number shown under the title. */
  number?: string;
  company: CompanyHeader;
  /** Header fields (dates, references, status...). */
  meta: Field[];
  /** Seller / buyer, employee, payee... boxes. */
  parties?: PartyBlock[];
  tables?: TableBlock[];
  /** Totals box (the last bold row is the grand total). */
  totals?: Field[];
  amountInWords?: string;
  qr?: { content: string; caption?: string };
  /** Additional reference lines (ETA UUID, print URL...). */
  references?: Field[];
  notes?: string[];
  signatures?: string[];
  /** Digits after the decimal point for money columns (default 2). */
  decimals?: number;
  /** File name without extension. */
  filename: string;
}
