import { StreamableFile } from '@nestjs/common';

/**
 * A streamable PDF that passes the global ResponseInterceptor untouched (it
 * leaves objects with a `success` key as they are).
 */
export class PdfFile extends StreamableFile {
  readonly success = true;

  constructor(buffer: Buffer, filename: string, disposition: 'inline' | 'attachment' = 'inline') {
    const safe = filename.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120) || 'document';
    super(buffer, {
      type: 'application/pdf',
      disposition: `${disposition}; filename="${safe}.pdf"`,
      length: buffer.length,
    });
  }
}
