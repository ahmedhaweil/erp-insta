import { mm, PdfCanvas } from '../engine/pdf-canvas';
import { Direction } from '../engine/bidi-text';

/** Position of one printed field on the cheque, in millimetres from the top-left corner. */
export interface ChequeFieldPosition {
  x: number;
  y: number;
  /** Box width (text wraps / aligns inside it). */
  width: number;
  /** Font size in points. */
  fontSize?: number;
  align?: 'left' | 'right' | 'center';
  /** Maximum lines (amount in words). */
  maxLines?: number;
  hidden?: boolean;
}

export type ChequeFieldKey = 'date' | 'payee' | 'amount' | 'amountWords' | 'memo';

export interface ChequeLayoutSpec {
  /** Cheque size in millimetres. */
  widthMm: number;
  heightMm: number;
  /** Text direction of the words (rtl for Arabic cheques). */
  direction?: Direction;
  /** Date format: e.g. YYYY-MM-DD, DD/MM/YYYY. */
  dateFormat?: string;
  /** Text printed around the numeric amount, e.g. "#" -> "#1,250.00#". */
  amountFrame?: string;
  fields: Partial<Record<ChequeFieldKey, ChequeFieldPosition>>;
  /** Shift applied to every field to compensate printer offsets (mm). */
  offsetX?: number;
  offsetY?: number;
}

export interface ChequeValues {
  date: string;
  payee: string;
  amount: string;
  amountWords: string;
  memo?: string;
}

/** A generic layout for a typical Egyptian/Saudi bank cheque (approx. 175 x 80 mm). */
export const DEFAULT_CHEQUE_LAYOUT: ChequeLayoutSpec = {
  widthMm: 175,
  heightMm: 80,
  direction: 'rtl',
  dateFormat: 'DD/MM/YYYY',
  amountFrame: '#',
  fields: {
    date: { x: 128, y: 12, width: 40, fontSize: 11, align: 'center' },
    payee: { x: 20, y: 27, width: 135, fontSize: 12, align: 'right' },
    amountWords: { x: 15, y: 38, width: 115, fontSize: 10.5, align: 'right', maxLines: 2 },
    amount: { x: 133, y: 40, width: 37, fontSize: 12, align: 'center' },
    memo: { x: 15, y: 62, width: 70, fontSize: 8, align: 'right', hidden: true },
  },
};

export function formatChequeDate(isoDate: string, format = 'YYYY-MM-DD'): string {
  const [y, m, d] = String(isoDate).slice(0, 10).split('-');
  if (!y || !m || !d) return isoDate;
  return format.replace('YYYY', y).replace('MM', m).replace('DD', d);
}

/** Prints the cheque fields only (pre-printed cheque stock), at their configured positions. */
export async function renderCheque(layout: ChequeLayoutSpec, values: ChequeValues): Promise<Buffer> {
  const c = new PdfCanvas({
    size: [mm(layout.widthMm), mm(layout.heightMm)],
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    direction: layout.direction ?? 'rtl',
    title: 'Cheque',
  });
  const ox = layout.offsetX ?? 0;
  const oy = layout.offsetY ?? 0;
  const frame = layout.amountFrame ?? '';
  const text: Record<ChequeFieldKey, string> = {
    date: formatChequeDate(values.date, layout.dateFormat),
    payee: values.payee,
    amount: `${frame}${values.amount}${frame}`,
    amountWords: values.amountWords,
    memo: values.memo ?? '',
  };
  for (const key of Object.keys(text) as ChequeFieldKey[]) {
    const pos = layout.fields[key];
    if (!pos || pos.hidden || !text[key]) continue;
    c.text(text[key], mm(pos.x + ox), mm(pos.y + oy), {
      width: mm(pos.width),
      size: pos.fontSize ?? 11,
      align: pos.align ?? 'right',
      maxLines: pos.maxLines,
      bold: key === 'amount',
      leading: 1.3,
    });
  }
  return c.finish();
}
