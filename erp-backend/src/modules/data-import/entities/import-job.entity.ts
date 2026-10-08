import { Column, Entity, Index } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import type { ImportIssue, ParsedRow } from '../utils/spreadsheet.util';

export enum ImportEntity {
  PRODUCTS = 'products',
  CUSTOMERS = 'customers',
  SUPPLIERS = 'suppliers',
  ACCOUNTS = 'accounts',
  EMPLOYEES = 'employees',
  OPENING_STOCK = 'opening_stock',
  OPENING_CUSTOMER_BALANCES = 'opening_customer_balances',
  OPENING_SUPPLIER_BALANCES = 'opening_supplier_balances',
}

export enum ImportJobStatus {
  /** Validated without errors; ready to commit. */
  VALIDATED = 'validated',
  /** Validation found errors; fix the file and upload it again. */
  INVALID = 'invalid',
  COMMITTED = 'committed',
  /** Commit attempted and rolled back (nothing was written). */
  FAILED = 'failed',
}

/**
 * One upload of a master-data / opening-balance file. The upload is parsed
 * and validated without touching business tables (status validated or
 * invalid); the commit writes every row or none.
 */
@Entity('data_import_jobs')
@Index(['tenantId', 'createdAt'])
export class ImportJob extends TenantBaseEntity {
  @Column({ type: 'enum', enum: ImportEntity })
  entity: ImportEntity;

  @Column({ type: 'enum', enum: ImportJobStatus })
  status: ImportJobStatus;

  @Column({ name: 'file_name' })
  fileName: string;

  /** Options given at upload (createMissing, updateExisting, date, offset account...). */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  options: Record<string, unknown>;

  @Column({ name: 'total_rows', type: 'int', default: 0 })
  totalRows: number;

  @Column({ name: 'error_rows', type: 'int', default: 0 })
  errorRows: number;

  @Column({ name: 'warning_rows', type: 'int', default: 0 })
  warningRows: number;

  /** Rows that will be / were created. */
  @Column({ name: 'create_count', type: 'int', default: 0 })
  createCount: number;

  /** Rows that will be / were updated (upsert by code). */
  @Column({ name: 'update_count', type: 'int', default: 0 })
  updateCount: number;

  @Column({ name: 'skip_count', type: 'int', default: 0 })
  skipCount: number;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  issues: ImportIssue[];

  /** Parsed rows kept for the commit and the error file (not selected by default). */
  @Column({ type: 'jsonb', default: () => "'[]'", select: false })
  rows: ParsedRow[];

  /** Commit outcome: journal entry, documents created, or the failure message. */
  @Column({ type: 'jsonb', nullable: true })
  result: Record<string, unknown> | null;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @Column({ name: 'committed_by', type: 'uuid', nullable: true })
  committedBy: string | null;

  @Column({ name: 'committed_at', type: 'timestamptz', nullable: true })
  committedAt: Date | null;
}
