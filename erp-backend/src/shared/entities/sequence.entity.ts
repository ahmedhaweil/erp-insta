import { Entity, Column, PrimaryColumn } from 'typeorm';

/**
 * Per-tenant document numbering (Odoo's ir.sequence). Numbers are allocated
 * atomically with an upsert so concurrent requests never get duplicates,
 * unlike counting existing rows.
 */
@Entity('sequences')
export class Sequence {
  @PrimaryColumn({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @PrimaryColumn()
  code: string;

  @Column({ name: 'next_number', type: 'int', default: 1 })
  nextNumber: number;
}
