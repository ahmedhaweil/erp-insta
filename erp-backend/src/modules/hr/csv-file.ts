import { StreamableFile } from '@nestjs/common';

/**
 * A streamable CSV download that passes the global ResponseInterceptor
 * untouched (it leaves objects with a `success` key as they are).
 */
export class CsvFile extends StreamableFile {
  readonly success = true;

  constructor(content: string, filename: string) {
    super(Buffer.from(content, 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
    });
  }
}
