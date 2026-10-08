/* Minimal typings for the untyped libraries used by the printing engine. */

declare module 'bidi-js' {
  namespace bidiFactory {
  interface EmbeddingLevels {
    levels: Uint8Array;
    paragraphs: { start: number; end: number; level: number }[];
  }
  interface Bidi {
    getEmbeddingLevels(text: string, direction?: 'ltr' | 'rtl' | 'auto'): EmbeddingLevels;
    getReorderSegments(
      text: string,
      levels: EmbeddingLevels,
      start?: number,
      end?: number,
    ): [number, number][];
    /** Note: takes the `levels` array, not the result object. */
    getMirroredCharactersMap(
      text: string,
      levels: Uint8Array,
      start?: number,
      end?: number,
    ): Map<number, string>;
  }
  }
  const bidiFactory: () => bidiFactory.Bidi;
  export = bidiFactory;
}

declare module 'qrcode' {
  export interface QRCodeModel {
    modules: { size: number; get(row: number, col: number): number | boolean };
  }
  export function create(
    text: string,
    options?: { errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' },
  ): QRCodeModel;
}

declare module 'pdfkit' {
  namespace PDFKit {
    interface PDFDocumentOptions {
      size?: string | [number, number];
      layout?: 'portrait' | 'landscape';
      margins?: { top: number; bottom: number; left: number; right: number };
      margin?: number;
      bufferPages?: boolean;
      autoFirstPage?: boolean;
      compress?: boolean;
      info?: Record<string, string | Date>;
      lang?: string;
    }
    interface TextOptions {
      lineBreak?: boolean;
      width?: number;
      height?: number;
      align?: 'left' | 'right' | 'center' | 'justify';
      baseline?: string;
      features?: string[];
    }
    interface Page {
      width: number;
      height: number;
      margins: { top: number; bottom: number; left: number; right: number };
    }
    interface PDFDocument extends NodeJS.EventEmitter {
      page: Page;
      x: number;
      y: number;
      registerFont(name: string, src: string | Buffer): this;
      font(name: string): this;
      fontSize(size: number): this;
      text(text: string, x?: number, y?: number, options?: TextOptions): this;
      widthOfString(text: string, options?: TextOptions): number;
      currentLineHeight(includeGap?: boolean): number;
      addPage(options?: PDFDocumentOptions): this;
      bufferedPageRange(): { start: number; count: number };
      switchToPage(n: number): this;
      fillColor(color: string, opacity?: number): this;
      strokeColor(color: string, opacity?: number): this;
      lineWidth(w: number): this;
      moveTo(x: number, y: number): this;
      lineTo(x: number, y: number): this;
      rect(x: number, y: number, w: number, h: number): this;
      roundedRect(x: number, y: number, w: number, h: number, r: number): this;
      fill(color?: string): this;
      stroke(color?: string): this;
      fillAndStroke(fill?: string, stroke?: string): this;
      dash(length: number, options?: { space?: number }): this;
      undash(): this;
      save(): this;
      restore(): this;
      end(): void;
    }
  }
  const PDFDocument: new (options?: PDFKit.PDFDocumentOptions) => PDFKit.PDFDocument;
  export = PDFDocument;
}
