import { mm, PdfCanvas } from '../engine/pdf-canvas';
import { baseDirection, ltr } from '../engine/bidi-text';
import { Field, PrintDocument, TableBlock } from './document.model';
import { dateTime, formatCell } from './format';
import { labels } from './labels';

const WIDTH = mm(80);
const MARGIN = 10;

/**
 * 80mm thermal receipt: one column, page height fitted to the content (a
 * first pass on a tall page measures it).
 */
export async function renderReceipt(doc: PrintDocument, now = new Date()): Promise<Buffer> {
  const probe = new PdfCanvas(canvasOptions(doc, 5000));
  const height = draw(probe, doc, now) + MARGIN;
  probe.doc.end();
  const c = new PdfCanvas(canvasOptions(doc, Math.max(height, 200)));
  draw(c, doc, now);
  return c.finish();
}

function canvasOptions(doc: PrintDocument, height: number) {
  return {
    size: [WIDTH, height] as [number, number],
    margins: { top: MARGIN, bottom: 0, left: MARGIN, right: MARGIN },
    direction: baseDirection(doc.lang),
    title: [doc.title, doc.number].filter(Boolean).join(' '),
    lang: doc.lang,
  };
}

/** Draws the receipt and returns the final y. */
function draw(c: PdfCanvas, doc: PrintDocument, now: Date): number {
  const t = labels(doc.lang);
  const w = c.contentWidth;
  const x = c.left;
  let y = c.top;
  const decimals = doc.decimals ?? 2;
  const center = (s: string, size = 8, bold = false) => {
    if (!s) return;
    y += c.text(s, x, y, { size, bold, width: w, align: 'center' });
  };
  const pair = (f: Field, size = 8) => {
    if (f.value === undefined || f.value === null || f.value === '') return;
    const value = String(f.value);
    const lw = w * 0.45;
    const vh = c.textHeight(value, { size, bold: f.bold, width: w - lw });
    c.text(f.label, c.startX(0, lw), y, { size, bold: f.bold, width: lw });
    c.text(value, c.startX(lw, w - lw), y, { size, bold: f.bold, width: w - lw, align: 'end' });
    y += Math.max(vh, c.lineHeight({ size }));
  };
  const rule = () => {
    y += 2;
    c.dashedLine(x, x + w, y);
    y += 4;
  };

  center(doc.company.name, 11, true);
  center(doc.company.branch ?? '', 8);
  if (doc.company.taxId) center(`${t('vatNumber')}: ${ltr(doc.company.taxId)}`, 8);
  if (doc.company.commercialRegistration)
    center(`${t('commercialRegistration')}: ${ltr(doc.company.commercialRegistration)}`, 7.5);
  center(doc.company.address ?? '', 7.5);
  center(doc.company.phone ? `${t('phone')}: ${ltr(doc.company.phone)}` : '', 7.5);
  rule();
  center(doc.title, 10.5, true);
  if (doc.subtitle) center(doc.subtitle, 8);
  if (doc.number) center(doc.number, 9, true);
  rule();
  for (const f of doc.meta) pair(f);
  for (const p of doc.parties ?? []) {
    const fields = p.fields.filter((f) => f.value);
    if (!fields.length) continue;
    rule();
    y += c.text(p.title, x, y, { size: 8, bold: true, width: w });
    for (const f of fields) {
      if (f.label) pair(f);
      else y += c.text(f.value, x, y, { size: 8, width: w });
    }
  }

  for (const table of doc.tables ?? []) {
    rule();
    if (table.title) y += c.text(table.title, x, y, { size: 8.5, bold: true, width: w });
    y = drawTable(c, table, y, decimals);
  }

  if (doc.totals?.length) {
    rule();
    doc.totals.forEach((f, i) => pair({ ...f, bold: f.bold ?? i === doc.totals!.length - 1 }, i === doc.totals!.length - 1 ? 9.5 : 8));
  }
  if (doc.amountInWords) {
    y += 2;
    y += c.text(doc.amountInWords, x, y, { size: 7.5, width: w, align: 'center' });
  }
  if (doc.qr) {
    rule();
    const size = Math.min(w * 0.62, 130);
    c.qr(doc.qr.content, x + (w - size) / 2, y, size);
    y += size + 2;
    if (doc.qr.caption) center(doc.qr.caption, 7);
  }
  for (const f of doc.references ?? []) {
    if (!f.value) continue;
    y += c.text(`${f.label}: ${f.value}`, x, y, { size: 6.5, width: w, align: 'center' });
  }
  for (const n of doc.notes ?? []) if (n) center(n, 7.5);
  rule();
  center(t('thankYou'), 8.5, true);
  center(ltr(dateTime(now)), 7);
  return y;
}

function drawTable(c: PdfCanvas, table: TableBlock, y: number, decimals: number): number {
  const w = c.contentWidth;
  const x = c.left;
  const col = (key: string) => table.columns.find((cc) => cc.key === key);
  const fmt = (row: Record<string, unknown>, key: string) => formatCell(row[key], col(key)?.format, decimals);

  table.rows.forEach((row) => {
    if (table.compact) {
      const { title, detail, amount } = table.compact;
      y += c.text(fmt(row, title), x, y, { size: 8, bold: true, width: w });
      const detailText = (detail ?? [])
        .map((k) => fmt(row, k))
        .filter(Boolean)
        .join(' × ');
      const amountText = amount ? fmt(row, amount) : '';
      const aw = w * 0.4;
      if (detailText) c.text(ltr(detailText), c.startX(0, w - aw), y, { size: 8, width: w - aw });
      if (amountText) c.text(amountText, c.startX(w - aw, aw), y, { size: 8, width: aw, align: 'end' });
      if (detailText || amountText) y += c.lineHeight({ size: 8 });
    } else {
      for (const cc of table.columns) {
        const v = fmt(row, cc.key);
        if (!v) continue;
        const lw = w * 0.45;
        const h = c.textHeight(v, { size: 7.5, width: w - lw });
        c.text(cc.label, c.startX(0, lw), y, { size: 7.5, width: lw });
        c.text(v, c.startX(lw, w - lw), y, { size: 7.5, width: w - lw, align: 'end' });
        y += h;
      }
      y += 2;
    }
  });
  if (table.footer) {
    for (const cc of table.columns) {
      const v = table.footer[cc.key];
      if (v === undefined || v === '') continue;
      c.text(cc.label, c.startX(0, w / 2), y, { size: 8, bold: true, width: w / 2 });
      c.text(formatCell(v, cc.format, decimals), c.startX(w / 2, w / 2), y, {
        size: 8,
        bold: true,
        width: w / 2,
        align: 'end',
      });
      y += c.lineHeight({ size: 8 });
    }
  }
  return y;
}
