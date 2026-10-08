import { ImportEntity } from '../entities/import-job.entity';
import type {
  BilingualText,
  ColumnSpec,
  ImportIssue,
  IssueSeverity,
  ParsedRow,
} from '../utils/spreadsheet.util';

export interface ImportOptions {
  /** Update records whose code already exists (default true); otherwise they are skipped. */
  updateExisting: boolean;
  /** Create missing product categories / units of measure (default false). */
  createMissing: boolean;
  /** Opening date for stock and balances (default today). */
  date?: string;
  /** Opening-equity (offset) account, by id or code. */
  offsetAccountId?: string;
  offsetAccountCode?: string;
}

export interface ImportContext {
  tenantId: string;
  userId: string;
  jobId: string;
  options: ImportOptions;
}

export type RowAction = 'create' | 'update' | 'skip';

export interface PlannedRow<T = Record<string, any>> {
  row: ParsedRow;
  action: RowAction;
  /** Resolved values (ids instead of codes) used by the commit. */
  data: T;
}

export interface ValidationOutcome<T = Record<string, any>> {
  planned: PlannedRow<T>[];
  issues: ImportIssue[];
  /** Extra information shown with the report (e.g. totals, offset account). */
  summary?: Record<string, unknown>;
}

export interface Importer<T = Record<string, any>> {
  readonly entity: ImportEntity;
  readonly title: BilingualText;
  readonly columns: ColumnSpec[];
  /** Checks every row against the file and the database; writes nothing. */
  validate(ctx: ImportContext, rows: ParsedRow[]): Promise<ValidationOutcome<T>>;
  /** Writes the planned rows; runs inside the request transaction (all or nothing). */
  commit(ctx: ImportContext, outcome: ValidationOutcome<T>): Promise<Record<string, unknown>>;
  /** Current master data as rows keyed by column key (master-data importers only). */
  exportRows?(tenantId: string): Promise<Record<string, unknown>[]>;
}

/** Collects row-level issues. */
export class IssueList {
  readonly items: ImportIssue[] = [];

  add(row: number, severity: IssueSeverity, code: string, message: string, column?: string): void {
    this.items.push({ row, column, severity, code, message });
  }

  error(row: number, code: string, message: string, column?: string): void {
    this.add(row, 'error', code, message, column);
  }

  warning(row: number, code: string, message: string, column?: string): void {
    this.add(row, 'warning', code, message, column);
  }

  rowHasError(row: number): boolean {
    return this.items.some((i) => i.row === row && i.severity === 'error');
  }
}

/** Case/space-insensitive lookup key. */
export function keyOf(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** Flags codes appearing more than once in the file. */
export function checkDuplicateCodes(rows: ParsedRow[], issues: IssueList, column = 'code'): void {
  const first = new Map<string, number>();
  for (const row of rows) {
    const code = row.values[column];
    if (code === undefined || code === null || code === '') continue;
    const k = keyOf(code);
    const at = first.get(k);
    if (at !== undefined) {
      issues.error(row.rowNumber, 'duplicate_in_file', `Code "${code}" already appears on row ${at}`, column);
    } else {
      first.set(k, row.rowNumber);
    }
  }
}

export const v = (row: ParsedRow, key: string): any => row.values[key];
export const has = (row: ParsedRow, key: string): boolean =>
  row.values[key] !== undefined && row.values[key] !== null && row.values[key] !== '';
