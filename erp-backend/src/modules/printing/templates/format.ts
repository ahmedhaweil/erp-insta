import { ColumnFormat, PrintLang } from './document.model';

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** 1,234.50 (Western digits, as printed on Egyptian/Saudi commercial documents). */
export function money(value: unknown, decimals = 2): string {
  if (value === null || value === undefined || value === '') return '';
  return num(value).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Quantity with up to 4 decimals, trailing zeros removed. */
export function qty(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  return num(value).toLocaleString('en-US', { maximumFractionDigits: 4 });
}

export function percent(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  return `${num(value).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
}

/** YYYY-MM-DD from a date string or Date. */
export function date(value: unknown): string {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/** YYYY-MM-DD HH:mm (UTC) from a timestamp. */
export function dateTime(value: unknown): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

export function formatCell(value: unknown, format: ColumnFormat | undefined, decimals = 2): string {
  if (value === null || value === undefined) return '';
  switch (format) {
    case 'money':
      return money(value, decimals);
    case 'qty':
      return qty(value);
    case 'percent':
      return percent(value);
    default:
      return String(value);
  }
}

/** Picks the Arabic or English name of a record, falling back to the other. */
export function localName(
  rec: { nameAr?: string | null; nameEn?: string | null } | null | undefined,
  lang: PrintLang,
): string {
  if (!rec) return '';
  return (lang === 'ar' ? rec.nameAr || rec.nameEn : rec.nameEn || rec.nameAr) || '';
}
