import { Column, Field, PartyBlock, PrintLang } from '../templates/document.model';
import { labels, LABELS, LabelKey } from '../templates/labels';
import { PartyView } from './views';

export const round4 = (v: number) => Math.round((Number(v) + Number.EPSILON) * 10000) / 10000;

/** Title in the other language, used as the document subtitle. */
export function otherLang(key: LabelKey, lang: PrintLang): string {
  return LABELS[key][lang === 'ar' ? 'en' : 'ar'];
}

export function partyBlock(title: string, p: PartyView, lang: PrintLang, vatLabel: LabelKey = 'taxNumber'): PartyBlock {
  const t = labels(lang);
  return {
    title,
    fields: [
      { label: t('name'), value: p.name, bold: true },
      { label: t('code'), value: p.code },
      { label: t(vatLabel), value: p.taxId },
      { label: t('commercialRegistration'), value: p.commercialRegistration },
      { label: t('address'), value: [p.address, p.city].filter(Boolean).join(' - ') },
      { label: t('phone'), value: p.phone },
      { label: t('email'), value: p.email },
    ],
  };
}

/** Drops empty fields. */
export function compact(fields: Field[]): Field[] {
  return fields.filter((f) => f.value !== undefined && f.value !== null && f.value !== '');
}

export function col(
  key: string,
  label: string,
  width: number,
  format?: Column['format'],
  align?: Column['align'],
): Column {
  return { key, label, width, format, align };
}

/** Line tax amount, consistent with the document-totals rules. */
export function lineTax(lineTotal: number, taxRate: number, gross?: number): number {
  if (gross !== undefined) return round4(gross - lineTotal);
  return round4((Number(lineTotal) * Number(taxRate)) / 100);
}
