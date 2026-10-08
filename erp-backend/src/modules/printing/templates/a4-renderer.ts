import { PAGE_A4, PdfCanvas } from '../engine/pdf-canvas';
import { baseDirection, ltr } from '../engine/bidi-text';
import { Field, PartyBlock, PrintDocument, TableBlock } from './document.model';
import { dateTime, formatCell } from './format';
import { labels } from './labels';

const C = {
  text: '#111111',
  muted: '#5b6472',
  line: '#c9d1dc',
  headFill: '#e8eef6',
  zebra: '#f7f9fc',
  accent: '#1f3a5f',
  totalFill: '#dfe8f3',
};

const FOOTER_SPACE = 8;

/** Renders a document on A4 (portrait or landscape) with page footers. */
export function renderA4(doc: PrintDocument, now = new Date()): Promise<Buffer> {
  return renderA4Batch([doc], now);
}

/**
 * Renders several documents of the same paper size into one PDF, each
 * starting on a new page with its own page numbering (e.g. all payslips of
 * a payroll run).
 */
export async function renderA4Batch(docs: PrintDocument[], now = new Date()): Promise<Buffer> {
  if (!docs.length) throw new Error('Nothing to render');
  const first = docs[0];
  const landscape = first.paper === 'a4-landscape';
  const size: [number, number] = landscape ? [PAGE_A4[1], PAGE_A4[0]] : PAGE_A4;
  const c = new PdfCanvas({
    size,
    margins: { top: 34, bottom: 46, left: 36, right: 36 },
    direction: baseDirection(first.lang),
    title: [first.title, docs.length === 1 ? first.number : ''].filter(Boolean).join(' '),
    lang: first.lang,
  });
  const layouts: { layout: A4Layout; start: number; end: number }[] = [];
  docs.forEach((doc, i) => {
    if (i > 0) c.addPage();
    const start = c.pageCount() - 1;
    const layout = new A4Layout(c, doc);
    layout.render();
    layouts.push({ layout, start, end: c.pageCount() - 1 });
  });
  for (const { layout, start, end } of layouts) layout.footers(now, start, end);
  return c.finish();
}

class A4Layout {
  private y: number;
  private readonly t: ReturnType<typeof labels>;

  constructor(
    private readonly c: PdfCanvas,
    private readonly doc: PrintDocument,
  ) {
    this.y = c.top;
    this.t = labels(doc.lang);
  }

  render() {
    this.header();
    this.meta(this.doc.meta);
    if (this.doc.parties?.length) this.parties(this.doc.parties);
    for (const table of this.doc.tables ?? []) this.table(table);
    this.totalsAndQr();
    this.amountInWords();
    this.references();
    this.notes();
    this.signatures();
  }

  /** Starts a new page when `h` points do not fit. */
  private ensure(h: number) {
    if (this.y + h > this.c.bottom - FOOTER_SPACE) {
      this.c.addPage();
      this.y = this.c.top;
    }
  }

  private header() {
    const { c, doc } = this;
    const w = c.contentWidth;
    const leftW = w * 0.58;
    const rightW = w * 0.4;
    const xCompany = c.startX(0, leftW);
    const xTitle = c.startX(w - rightW, rightW);
    let yl = this.y;
    yl += c.text(doc.company.name, xCompany, yl, { size: 15, bold: true, width: leftW, color: C.accent });
    const info: string[] = [];
    if (doc.company.branch) info.push(doc.company.branch);
    if (doc.company.taxId) info.push(`${this.t('taxNumber')}: ${ltr(doc.company.taxId)}`);
    if (doc.company.commercialRegistration)
      info.push(`${this.t('commercialRegistration')}: ${ltr(doc.company.commercialRegistration)}`);
    if (doc.company.address) info.push(doc.company.address);
    const contact = [doc.company.phone, doc.company.email].filter(Boolean).map((v) => ltr(v)).join('  |  ');
    if (contact) info.push(contact);
    for (const line of info) yl += c.text(line, xCompany, yl, { size: 8.5, width: leftW, color: C.muted });

    let yr = this.y;
    yr += c.text(doc.title, xTitle, yr, { size: 17, bold: true, width: rightW, align: 'end', color: C.accent });
    if (doc.subtitle) yr += c.text(doc.subtitle, xTitle, yr, { size: 10, width: rightW, align: 'end', color: C.muted });
    if (doc.number) yr += c.text(doc.number, xTitle, yr, { size: 11, bold: true, width: rightW, align: 'end' });

    this.y = Math.max(yl, yr) + 6;
    c.hline(c.left, c.right, this.y, C.accent, 1.2);
    this.y += 8;
  }

  /** Header fields in a grid: label above value. */
  private meta(fields: Field[]) {
    const list = fields.filter((f) => f.value !== undefined && f.value !== null && f.value !== '');
    if (!list.length) return;
    const { c } = this;
    const cols = this.doc.paper === 'a4-landscape' ? 6 : 4;
    const cw = c.contentWidth / cols;
    for (let i = 0; i < list.length; i += cols) {
      const row = list.slice(i, i + cols);
      const heights = row.map((f) => c.textHeight(String(f.value), { size: 9.5, width: cw - 6, bold: true }));
      const h = c.lineHeight({ size: 8 }) + Math.max(...heights);
      this.ensure(h + 4);
      row.forEach((f, j) => {
        const x = c.startX(j * cw, cw - 6);
        c.text(f.label, x, this.y, { size: 8, width: cw - 6, color: C.muted });
        c.text(f.value, x, this.y + c.lineHeight({ size: 8 }), { size: 9.5, width: cw - 6, bold: true });
      });
      this.y += h + 4;
    }
    this.y += 4;
  }

  private parties(parties: PartyBlock[]) {
    const { c } = this;
    const gap = 10;
    const n = Math.min(parties.length, 2);
    const bw = (c.contentWidth - gap * (n - 1)) / n;
    const labelW = bw * 0.36;
    const pad = 6;
    for (let i = 0; i < parties.length; i += n) {
      const row = parties.slice(i, i + n);
      const heights = row.map(
        (p) =>
          c.lineHeight({ size: 9.5 }) +
          6 +
          p.fields
            .filter((f) => f.value !== undefined && f.value !== null && f.value !== '')
            .reduce(
              (s, f) =>
                s +
                Math.max(
                  c.textHeight(String(f.value), { size: 9, width: (f.label ? bw - labelW : bw) - 2 * pad }),
                  c.lineHeight({ size: 9 }),
                ),
              0,
            ) +
          pad,
      );
      const h = Math.max(...heights);
      this.ensure(h + 8);
      row.forEach((p, j) => {
        const x = c.startX(j * (bw + gap), bw);
        const th = c.lineHeight({ size: 9.5 }) + 4;
        c.box(x, this.y, bw, h, { stroke: C.line, radius: 3 });
        c.box(x, this.y, bw, th, { fill: C.headFill, radius: 3 });
        c.text(p.title, x + pad, this.y + 2, { size: 9.5, bold: true, width: bw - 2 * pad, color: C.accent });
        let yy = this.y + th + 2;
        for (const f of p.fields) {
          if (f.value === undefined || f.value === null || f.value === '') continue;
          if (f.label) {
            c.text(f.label, c.startX(pad, labelW - pad, x, bw), yy, { size: 9, width: labelW - pad, color: C.muted });
            const used = c.text(f.value, c.startX(labelW, bw - labelW - pad, x, bw), yy, {
              size: 9,
              width: bw - labelW - pad,
              bold: f.bold,
            });
            yy += Math.max(used, c.lineHeight({ size: 9 }));
          } else {
            yy += c.text(f.value, c.startX(pad, bw - 2 * pad, x, bw), yy, { size: 9, width: bw - 2 * pad, bold: f.bold });
          }
        }
      });
      this.y += h + 8;
    }
  }

  private table(table: TableBlock) {
    const { c, doc } = this;
    const decimals = doc.decimals ?? 2;
    const totalWeight = table.columns.reduce((s, col) => s + col.width, 0);
    const widths = table.columns.map((col) => (col.width / totalWeight) * c.contentWidth);
    const offsets = widths.map((_, i) => widths.slice(0, i).reduce((a, b) => a + b, 0));
    const pad = 3;
    const size = table.columns.length > 9 ? 7.5 : 8.5;

    const cellText = (row: Record<string, unknown>, i: number, index: number) => {
      const col = table.columns[i];
      if (col.format === 'index' && row[col.key] === undefined) return String(index + 1);
      return formatCell(row[col.key], col.format, decimals);
    };
    const rowHeight = (texts: string[], bold = false) =>
      Math.max(
        ...texts.map((s, i) => c.textHeight(s, { size, bold, width: widths[i] - 2 * pad })),
        c.lineHeight({ size }),
      ) + 4;

    const header = () => {
      const texts = table.columns.map((col) => col.label);
      const h = rowHeight(texts, true);
      c.box(c.left, this.y, c.contentWidth, h, { fill: C.headFill, stroke: C.line });
      table.columns.forEach((col, i) => {
        c.text(col.label, c.startX(offsets[i] + pad, widths[i] - 2 * pad), this.y + 2, {
          size,
          bold: true,
          width: widths[i] - 2 * pad,
          align: 'center',
        });
      });
      this.y += h;
    };

    if (table.title) {
      this.ensure(c.lineHeight({ size: 10.5 }) + 40);
      this.y += c.text(table.title, c.left, this.y, { size: 10.5, bold: true, width: c.contentWidth, color: C.accent });
    }
    this.ensure(40);
    header();

    const drawRow = (texts: string[], h: number, fill?: string, bold = false) => {
      if (fill) c.box(c.left, this.y, c.contentWidth, h, { fill });
      table.columns.forEach((col, i) => {
        c.text(texts[i], c.startX(offsets[i] + pad, widths[i] - 2 * pad), this.y + 2, {
          size,
          bold,
          width: widths[i] - 2 * pad,
          align: col.align ?? (col.format && col.format !== 'text' ? 'end' : 'start'),
        });
      });
      c.hline(c.left, c.right, this.y + h, C.line, 0.4);
      this.y += h;
    };

    table.rows.forEach((row, index) => {
      const texts = table.columns.map((_, i) => cellText(row, i, index));
      const h = rowHeight(texts);
      if (this.y + h > c.bottom - FOOTER_SPACE) {
        c.addPage();
        this.y = c.top;
        header();
      }
      drawRow(texts, h, index % 2 ? C.zebra : undefined);
    });
    if (!table.rows.length) {
      const h = c.lineHeight({ size }) + 4;
      c.text('—', c.left, this.y + 2, { size, width: c.contentWidth, align: 'center', color: C.muted });
      c.hline(c.left, c.right, this.y + h, C.line, 0.4);
      this.y += h;
    }
    if (table.footer) {
      const footer = table.footer;
      const texts = table.columns.map((col) =>
        footer[col.key] === undefined ? '' : formatCell(footer[col.key], col.format, decimals),
      );
      const h = rowHeight(texts, true);
      this.ensure(h);
      drawRow(texts, h, C.totalFill, true);
    }
    this.y += 10;
  }

  private totalsAndQr() {
    const { c, doc } = this;
    const totals = doc.totals ?? [];
    const qrSize = doc.paper === 'a4-landscape' ? 90 : 96;
    if (!totals.length && !doc.qr) return;
    const bw = c.contentWidth * 0.46;
    const labelW = bw * 0.58;
    const rowH = c.lineHeight({ size: 9.5 }) + 4;
    const qrH = doc.qr ? qrSize + (doc.qr.caption ? c.textHeight(doc.qr.caption, { size: 7, width: 170 }) + 2 : 0) : 0;
    const h = Math.max(totals.length * rowH, qrH);
    this.ensure(h + 6);

    const x = c.startX(c.contentWidth - bw, bw);
    let yy = this.y;
    totals.forEach((f, i) => {
      const last = f.bold ?? i === totals.length - 1;
      if (last) c.box(x, yy, bw, rowH, { fill: C.totalFill });
      c.text(f.label, c.startX(4, labelW - 4, x, bw), yy + 2, { size: 9.5, bold: last, width: labelW - 4 });
      c.text(f.value, c.startX(labelW, bw - labelW - 4, x, bw), yy + 2, {
        size: 9.5,
        bold: last,
        width: bw - labelW - 4,
        align: 'end',
      });
      c.hline(x, x + bw, yy + rowH, C.line, 0.4);
      yy += rowH;
    });
    if (totals.length) c.box(x, this.y, bw, totals.length * rowH, { stroke: C.line });

    if (doc.qr) {
      const qx = c.startX(0, qrSize);
      c.qr(doc.qr.content, qx, this.y, qrSize);
      if (doc.qr.caption) {
        const cw = 170;
        c.text(doc.qr.caption, c.startX(0, cw), this.y + qrSize + 2, { size: 7, width: cw, color: C.muted });
      }
    }
    this.y += h + 8;
  }

  private amountInWords() {
    const { c, doc } = this;
    if (!doc.amountInWords) return;
    const label = `${this.t('amountInWords')}: `;
    const text = `${label}${doc.amountInWords}`;
    const h = c.textHeight(text, { size: 9.5, width: c.contentWidth - 12 }) + 8;
    this.ensure(h);
    c.box(c.left, this.y, c.contentWidth, h, { fill: C.zebra, stroke: C.line, radius: 3 });
    c.text(text, c.left + 6, this.y + 4, { size: 9.5, bold: true, width: c.contentWidth - 12 });
    this.y += h + 8;
  }

  private references() {
    const refs = (this.doc.references ?? []).filter((f) => f.value);
    if (!refs.length) return;
    const { c } = this;
    for (const f of refs) {
      const lw = 130;
      const h = c.textHeight(String(f.value), { size: 8, width: c.contentWidth - lw });
      this.ensure(h);
      c.text(f.label, c.startX(0, lw), this.y, { size: 8, width: lw, color: C.muted });
      c.text(f.value, c.startX(lw, c.contentWidth - lw), this.y, { size: 8, width: c.contentWidth - lw });
      this.y += h;
    }
    this.y += 6;
  }

  private notes() {
    const notes = (this.doc.notes ?? []).filter(Boolean);
    if (!notes.length) return;
    const { c } = this;
    this.ensure(c.lineHeight({ size: 9 }) * 2);
    this.y += c.text(this.t('notes'), c.left, this.y, { size: 9, bold: true, width: c.contentWidth });
    for (const n of notes) {
      const h = c.textHeight(n, { size: 8.5, width: c.contentWidth });
      this.ensure(h);
      this.y += c.text(n, c.left, this.y, { size: 8.5, width: c.contentWidth, color: C.muted });
    }
    this.y += 6;
  }

  private signatures() {
    const sigs = this.doc.signatures ?? [];
    if (!sigs.length) return;
    const { c } = this;
    const h = 46;
    this.ensure(h);
    this.y = Math.max(this.y + 10, Math.min(c.bottom - FOOTER_SPACE - h, this.y + 30));
    const cw = c.contentWidth / sigs.length;
    sigs.forEach((s, i) => {
      const x = c.startX(i * cw, cw);
      c.text(s, x, this.y, { size: 9, bold: true, width: cw, align: 'center' });
      c.dashedLine(x + 18, x + cw - 18, this.y + 34);
    });
    this.y += h;
  }

  /** Page numbers and print time on every page. */
  footers(now: Date, firstPage: number, lastPage: number) {
    const { c, doc } = this;
    const fy = c.pageHeight - 34;
    c.eachPage((page) => {
      if (page < firstPage || page > lastPage) return;
      const i = page - firstPage;
      const count = lastPage - firstPage + 1;
      c.hline(c.left, c.right, fy - 4, C.line, 0.5);
      const third = c.contentWidth / 3;
      c.text(`${this.t('page')} ${i + 1} ${this.t('of')} ${count}`, c.left + third, fy, {
        size: 8,
        width: third,
        align: 'center',
        color: C.muted,
      });
      c.text(`${this.t('printedAt')}: ${ltr(dateTime(now))}`, c.startX(0, third), fy, {
        size: 8,
        width: third,
        color: C.muted,
      });
      c.text([doc.title, doc.number ? ltr(doc.number) : ''].filter(Boolean).join(' - '), c.startX(2 * third, third), fy, {
        size: 8,
        width: third,
        align: 'end',
        color: C.muted,
        maxLines: 1,
      });
    });
  }
}
