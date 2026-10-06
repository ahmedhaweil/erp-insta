import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class SequenceService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Atomically allocates the next number for `code` within a tenant and
   * returns it formatted as `${prefix}-000001`.
   */
  async next(tenantId: string, code: string, prefix = code, padding = 6): Promise<string> {
    const rows: { value: number }[] = await this.dataSource.query(
      `INSERT INTO sequences (tenant_id, code, next_number)
       VALUES ($1, $2, 2)
       ON CONFLICT (tenant_id, code)
       DO UPDATE SET next_number = sequences.next_number + 1
       RETURNING next_number - 1 AS value`,
      [tenantId, code],
    );
    const value = Number(rows[0].value);
    return `${prefix}-${String(value).padStart(padding, '0')}`;
  }
}
