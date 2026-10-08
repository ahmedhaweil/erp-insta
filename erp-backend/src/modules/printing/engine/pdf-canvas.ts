import * as fs from 'fs';
import * as path from 'path';
import PDFDocument = require('pdfkit');
import * as QRCode from 'qrcode';
import { Direction, visualChunks } from './bidi-text';

/**
 * Bundled fonts (Amiri, SIL OFL 1.1 - see assets/fonts/OFL.txt). Amiri covers
 * Arabic and Latin, so mixed bilingual lines render with one font.
 */
const FONT_FILES = { regular: 'Amiri-Regular.ttf', bold: 'Amiri-Bold.ttf' };

let fontCache: { regular: Buffer; bold: Buffer } | null = null;

/** Locates assets/fonts in the source tree, the dist tree or the working dir. */
export function fontsDir(): string {
  const candidates = [
    process.env.PRINT_FONTS_DIR,
    // src/modules/printing/engine -> erp-backend/assets/fonts (same depth from dist/)
    path.resolve(__dirname, '../../../../assets/fonts'),
    path.resolve(process.cwd(), 'assets/fonts'),
  ].filter((p): p is string => !!p);
  const dir = candidates.find((p) => fs.existsSync(path.join(p, FONT_FILES.regular)));
  if (!dir) throw new Error(`Printing fonts not found (looked in ${candidates.join(', ')})`);
  return dir;
}

function loadFonts() {
  if (!fontCache) {
    const dir = fontsDir();
    fontCache = {
      regular: fs.readFileSync(path.join(dir, FONT_FILES.regular)),
      bold: fs.readFileSync(path.join(dir, FONT_FILES.bold)),
    };
  }
  return fontCache;
}

export type Align = 'start' | 'end' | 'center' | 'left' | 'right';

export interface TextStyle {
  size?: number;
  bold?: boolean;
  color?: string;
  align?: Align;
  /** Box width; text wraps inside it. */
  width?: number;
  /** Maximum number of lines (extra text is cut with an ellipsis). */
  maxLines?: number;
  /** Line height multiplier. */
  leading?: number;
}

export interface CanvasOptions {
  /** Page size in points. */
  size: [number, number];
  margins: { top: number; bottom: number; left: number; right: number };
  direction: Direction;
  title?: string;
  lang?: string;
}

/** Millimetres to PDF points. */
export const mm = (v: number) => (v * 72) / 25.4;

export const PAGE_A4: [number, number] = [595.28, 841.89];

/**
 * Thin wrapper around a PDFKit document that draws bidirectional text
 * (Arabic shaped by the font, ordered by the Unicode bidi algorithm) and a
 * few primitives used by the document templates.
 */
export class PdfCanvas {
  readonly doc: InstanceType<typeof PDFDocument>;
  readonly dir: Direction;
  private readonly chunks: Buffer[] = [];
  private readonly done: Promise<Buffer>;

  constructor(readonly options: CanvasOptions) {
    const fonts = loadFonts();
    this.dir = options.direction;
    this.doc = new PDFDocument({
      size: options.size,
      margins: options.margins,
      bufferPages: true,
      autoFirstPage: true,
      lang: options.lang,
      info: { Title: options.title ?? 'Document', Producer: 'ERP', Creator: 'ERP' },
    });
    this.doc.registerFont('regular', fonts.regular);
    this.doc.registerFont('bold', fonts.bold);
    this.doc.font('regular');
    this.done = new Promise<Buffer>((resolve, reject) => {
      this.doc.on('data', (c: Buffer) => this.chunks.push(c));
      this.doc.on('end', () => resolve(Buffer.concat(this.chunks)));
      this.doc.on('error', reject);
    });
  }

  get pageWidth() {
    return this.doc.page.width;
  }
  get pageHeight() {
    return this.doc.page.height;
  }
  get left() {
    return this.options.margins.left;
  }
  get right() {
    return this.pageWidth - this.options.margins.right;
  }
  get top() {
    return this.options.margins.top;
  }
  get bottom() {
    return this.pageHeight - this.options.margins.bottom;
  }
  get contentWidth() {
    return this.right - this.left;
  }
  get rtl() {
    return this.dir === 'rtl';
  }

  /** x of a box of width `w` placed at offset `offset` from the start edge. */
  startX(offset: number, w: number, areaLeft = this.left, areaWidth = this.contentWidth): number {
    return this.rtl ? areaLeft + areaWidth - offset - w : areaLeft + offset;
  }

  private use(style: TextStyle) {
    this.doc.font(style.bold ? 'bold' : 'regular').fontSize(style.size ?? 9);
  }

  lineHeight(style: TextStyle = {}): number {
    return (style.size ?? 9) * (style.leading ?? 1.45);
  }

  /** Visual width of one line. */
  measure(text: string, style: TextStyle = {}): number {
    this.use(style);
    return visualChunks(text, this.dir).reduce((w, c) => w + this.doc.widthOfString(c.text), 0);
  }

  /** Wraps text (logical order) into lines that fit `width`. */
  wrap(text: string, width: number, style: TextStyle = {}): string[] {
    const out: string[] = [];
    for (const paragraph of String(text ?? '').split(/\r?\n/)) {
      const words = paragraph.split(/ +/).filter((w) => w.length);
      if (!words.length) {
        out.push('');
        continue;
      }
      let line = '';
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (!line || this.measure(candidate, style) <= width) {
          line = candidate;
          // A single word wider than the box is split by characters.
          if (this.measure(line, style) > width && line === word) {
            let piece = '';
            for (const ch of Array.from(word)) {
              if (piece && this.measure(piece + ch, style) > width) {
                out.push(piece);
                piece = '';
              }
              piece += ch;
            }
            line = piece;
          }
        } else {
          out.push(line);
          line = word;
        }
      }
      out.push(line);
    }
    return out;
  }

  /** Height a text block would take. */
  textHeight(text: string, style: TextStyle = {}): number {
    const lines = style.width ? this.wrap(text, style.width, style) : String(text ?? '').split(/\r?\n/);
    const n = style.maxLines ? Math.min(lines.length, style.maxLines) : lines.length;
    return n * this.lineHeight(style);
  }

  /**
   * Draws text in the box starting at (x, y). Alignment start/end follows the
   * document direction. Returns the height used.
   */
  text(value: unknown, x: number, y: number, style: TextStyle = {}): number {
    const text = value === null || value === undefined ? '' : String(value);
    const width = style.width ?? this.right - x;
    let lines = this.wrap(text, width, style);
    if (style.maxLines && lines.length > style.maxLines) {
      lines = lines.slice(0, style.maxLines);
      lines[lines.length - 1] = `${lines[lines.length - 1]}…`;
    }
    const lh = this.lineHeight(style);
    const align = this.resolveAlign(style.align ?? 'start');
    this.use(style);
    this.doc.fillColor(style.color ?? '#111111');
    lines.forEach((line, i) => this.drawLine(line, x, y + i * lh, width, align, style));
    return lines.length * lh;
  }

  private resolveAlign(align: Align): 'left' | 'right' | 'center' {
    if (align === 'start') return this.rtl ? 'right' : 'left';
    if (align === 'end') return this.rtl ? 'left' : 'right';
    return align;
  }

  private drawLine(line: string, x: number, y: number, width: number, align: string, style: TextStyle) {
    const chunks = visualChunks(line, this.dir);
    this.use(style);
    const widths = chunks.map((c) => this.doc.widthOfString(c.text));
    const total = widths.reduce((a, b) => a + b, 0);
    let cx = align === 'right' ? x + width - total : align === 'center' ? x + (width - total) / 2 : x;
    // Vertical centering of Amiri's tall line box around the requested leading.
    const dy = ((style.leading ?? 1.45) - 1.75) * (style.size ?? 9) * 0.5;
    chunks.forEach((c, i) => {
      if (!c.space) this.doc.text(c.text, cx, y + dy, { lineBreak: false });
      cx += widths[i];
    });
  }

  hline(x1: number, x2: number, y: number, color = '#999999', width = 0.5) {
    this.doc.save().lineWidth(width).strokeColor(color).moveTo(x1, y).lineTo(x2, y).stroke().restore();
  }

  dashedLine(x1: number, x2: number, y: number, color = '#666666') {
    this.doc
      .save()
      .lineWidth(0.5)
      .strokeColor(color)
      .dash(2, { space: 2 })
      .moveTo(x1, y)
      .lineTo(x2, y)
      .stroke()
      .undash()
      .restore();
  }

  box(x: number, y: number, w: number, h: number, opts: { fill?: string; stroke?: string; radius?: number } = {}) {
    this.doc.save().lineWidth(0.6);
    if (opts.radius) this.doc.roundedRect(x, y, w, h, opts.radius);
    else this.doc.rect(x, y, w, h);
    if (opts.fill && opts.stroke) this.doc.fillAndStroke(opts.fill, opts.stroke);
    else if (opts.fill) this.doc.fill(opts.fill);
    else this.doc.stroke(opts.stroke ?? '#999999');
    this.doc.restore();
  }

  /** Vector QR code (no raster image) of `size` points at (x, y). */
  qr(content: string, x: number, y: number, size: number) {
    const model = QRCode.create(content, { errorCorrectionLevel: 'M' });
    const n = model.modules.size;
    const quiet = 2;
    const cell = size / (n + quiet * 2);
    this.doc.save().rect(x, y, size, size).fill('#ffffff');
    this.doc.fillColor('#000000');
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (model.modules.get(r, c)) {
          // Slight overlap avoids hairline gaps between modules in viewers.
          this.doc.rect(x + (c + quiet) * cell, y + (r + quiet) * cell, cell + 0.05, cell + 0.05);
        }
      }
    }
    this.doc.fill('#000000').restore();
  }

  addPage() {
    this.doc.addPage({ size: this.options.size, margins: this.options.margins });
  }

  pageCount(): number {
    return this.doc.bufferedPageRange().count;
  }

  /** Runs `draw` on every buffered page (page index, page count). */
  eachPage(draw: (index: number, count: number) => void) {
    const range = this.doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      this.doc.switchToPage(i);
      draw(i - range.start, range.count);
    }
  }

  async finish(): Promise<Buffer> {
    this.doc.end();
    return this.done;
  }
}
