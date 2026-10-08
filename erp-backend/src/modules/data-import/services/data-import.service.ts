import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Propagation, runInTransaction } from 'typeorm-transactional';
import { ImportEntity, ImportJob, ImportJobStatus } from '../entities/import-job.entity';
import { ImportOptionsDto, ImportJobQueryDto, UploadedSpreadsheet } from '../dto/data-import.dto';
import { ImportContext, ImportOptions, Importer, ValidationOutcome } from '../importers/importer.types';
import { ProductsImporter } from '../importers/products.importer';
import { CustomersImporter, SuppliersImporter } from '../importers/partners.importer';
import { AccountsImporter } from '../importers/accounts.importer';
import { EmployeesImporter } from '../importers/employees.importer';
import { OpeningStockImporter } from '../importers/opening-stock.importer';
import {
  OpeningCustomerBalancesImporter,
  OpeningSupplierBalancesImporter,
} from '../importers/opening-balances.importer';
import {
  ImportIssue,
  ParsedRow,
  buildWorkbook,
  errorSheets,
  headerText,
  parseSpreadsheet,
  templateSheets,
} from '../utils/spreadsheet.util';

const MAX_FILE_BYTES = 10 * 1024 * 1024;

export interface ImportReport {
  job: ImportJob;
  summary?: Record<string, unknown>;
}

export interface FileDownload {
  buffer: Buffer;
  filename: string;
}

/**
 * Two-phase data onboarding: upload -> validation report (nothing written to
 * business tables) -> commit (every row or none, re-validated against the
 * current data), with a job record and a downloadable error file.
 */
@Injectable()
export class DataImportService {
  private readonly logger = new Logger(DataImportService.name);
  private readonly importers: Map<ImportEntity, Importer>;

  constructor(
    @InjectRepository(ImportJob) private readonly jobRepo: Repository<ImportJob>,
    products: ProductsImporter,
    customers: CustomersImporter,
    suppliers: SuppliersImporter,
    accounts: AccountsImporter,
    employees: EmployeesImporter,
    openingStock: OpeningStockImporter,
    openingCustomers: OpeningCustomerBalancesImporter,
    openingSuppliers: OpeningSupplierBalancesImporter,
  ) {
    const list: Importer[] = [
      products,
      customers,
      suppliers,
      accounts,
      employees,
      openingStock,
      openingCustomers,
      openingSuppliers,
    ];
    this.importers = new Map(list.map((i) => [i.entity, i]));
  }

  /** Importable entities with their columns (for the UI). */
  catalog() {
    return [...this.importers.values()].map((i) => ({
      entity: i.entity,
      title: i.title,
      exportable: !!i.exportRows,
      columns: i.columns.map((c) => ({
        key: c.key,
        label: c.label,
        header: headerText(c),
        type: c.type ?? 'string',
        required: !!c.required,
        values: c.values?.map((v) => v.value),
        note: c.note,
      })),
    }));
  }

  async template(entity: ImportEntity, lang: 'ar' | 'en' = 'ar'): Promise<FileDownload> {
    const importer = this.importer(entity);
    const buffer = await buildWorkbook(templateSheets(importer.title, importer.columns), lang === 'ar');
    return { buffer, filename: `${entity}-template.xlsx` };
  }

  async exportData(tenantId: string, entity: ImportEntity, lang: 'ar' | 'en' = 'ar'): Promise<FileDownload> {
    const importer = this.importer(entity);
    if (!importer.exportRows) throw new BadRequestException(`${entity} cannot be exported`);
    const rows = await importer.exportRows(tenantId);
    const buffer = await buildWorkbook(
      [
        {
          name: 'Data',
          headers: importer.columns.map(headerText),
          rows: rows.map((r) => importer.columns.map((c) => (r[c.key] === undefined ? null : r[c.key]))),
          widths: importer.columns.map((c) => c.width ?? 22),
        },
      ],
      lang === 'ar',
    );
    return { buffer, filename: `${entity}-${new Date().toISOString().slice(0, 10)}.xlsx` };
  }

  /** Phase 1: parse and validate; stores the job and returns the report. */
  async upload(
    tenantId: string,
    userId: string,
    entity: ImportEntity,
    file: UploadedSpreadsheet | undefined,
    dto: ImportOptionsDto = {},
  ): Promise<ImportReport> {
    const importer = this.importer(entity);
    if (!file?.buffer?.length) throw new BadRequestException('Upload a .xlsx or .csv file in the "file" field');
    if (file.size > MAX_FILE_BYTES) throw new BadRequestException('The file is larger than 10 MB');
    if (!/\.(xlsx|csv|txt)$/i.test(file.originalname || '')) {
      throw new BadRequestException('Only .xlsx and .csv files are accepted');
    }

    const options = this.options(dto);
    const parsed = await parseSpreadsheet(file.buffer, file.originalname, importer.columns);
    const job = this.jobRepo.create({
      tenantId,
      entity,
      fileName: file.originalname,
      options: { ...options },
      createdBy: userId,
      rows: parsed.rows,
      status: ImportJobStatus.INVALID,
      issues: [],
    });
    const saved = await this.jobRepo.save(job);

    const outcome = await this.check(importer, this.context(tenantId, userId, saved.id, options), parsed.rows, parsed.issues);
    this.applyOutcome(saved, parsed.rows, outcome);
    saved.status = this.hasErrors(saved.issues) ? ImportJobStatus.INVALID : ImportJobStatus.VALIDATED;
    await this.jobRepo.save(saved);
    return { job: this.strip(saved), summary: outcome.summary };
  }

  /**
   * Phase 2: re-validates the stored rows against the current data and writes
   * them all, or nothing. A failure is recorded on the job (status failed).
   */
  async commit(tenantId: string, userId: string, jobId: string): Promise<ImportReport> {
    const job = await this.jobRepo
      .createQueryBuilder('j')
      .addSelect('j.rows')
      .where('j.id = :jobId AND j.tenant_id = :tenantId', { jobId, tenantId })
      .getOne();
    if (!job) throw new NotFoundException('Import job not found');
    if (job.status === ImportJobStatus.COMMITTED) throw new ConflictException('This import was already committed');
    if (job.status === ImportJobStatus.INVALID) {
      throw new BadRequestException('The file has errors; download the error file, fix it and upload it again');
    }
    const importer = this.importer(job.entity);
    const options = this.options(job.options as ImportOptionsDto);
    const ctx = this.context(tenantId, userId, job.id, options);

    const outcome = await this.check(importer, ctx, job.rows ?? [], []);
    this.applyOutcome(job, job.rows ?? [], outcome);
    if (this.hasErrors(job.issues)) {
      job.status = ImportJobStatus.FAILED;
      job.result = { error: 'Validation failed against the current data; nothing was imported' };
      await this.jobRepo.save(job);
      return { job: this.strip(job), summary: outcome.summary };
    }

    try {
      const result = await this.runAtomically(() => importer.commit(ctx, outcome));
      job.status = ImportJobStatus.COMMITTED;
      job.result = result;
      job.committedAt = new Date();
      job.committedBy = userId;
    } catch (err) {
      this.logger.warn(`Import ${job.id} (${job.entity}) rolled back: ${(err as Error).message}`);
      job.status = ImportJobStatus.FAILED;
      job.result = { error: (err as Error).message };
    }
    await this.jobRepo.save(job);
    return { job: this.strip(job), summary: outcome.summary };
  }

  findJobs(tenantId: string, query: ImportJobQueryDto = {}): Promise<ImportJob[]> {
    const where: Record<string, unknown> = { tenantId };
    if (query.entity) where.entity = query.entity;
    if (query.status) where.status = query.status;
    return this.jobRepo.find({ where, order: { createdAt: 'DESC' }, take: query.limit ?? 50 });
  }

  async findJob(tenantId: string, id: string): Promise<ImportJob> {
    const job = await this.jobRepo.findOne({ where: { id, tenantId } });
    if (!job) throw new NotFoundException('Import job not found');
    return job;
  }

  /** The uploaded rows having issues, with their errors and warnings, as .xlsx. */
  async errorFile(tenantId: string, id: string, lang: 'ar' | 'en' = 'ar'): Promise<FileDownload> {
    const job = await this.jobRepo
      .createQueryBuilder('j')
      .addSelect('j.rows')
      .where('j.id = :id AND j.tenant_id = :tenantId', { id, tenantId })
      .getOne();
    if (!job) throw new NotFoundException('Import job not found');
    const importer = this.importer(job.entity);
    const buffer = await buildWorkbook(errorSheets(importer.columns, job.rows ?? [], job.issues ?? []), lang === 'ar');
    return { buffer, filename: `${job.entity}-errors-${job.id.slice(0, 8)}.xlsx` };
  }

  // ---------------------------------------------------------------------------

  private importer(entity: ImportEntity): Importer {
    const importer = this.importers.get(entity);
    if (!importer) throw new BadRequestException(`Unknown import type "${entity}"`);
    return importer;
  }

  private options(dto: ImportOptionsDto | Record<string, unknown>): ImportOptions {
    const d = dto as ImportOptionsDto;
    return {
      updateExisting: d.updateExisting !== false,
      createMissing: d.createMissing === true,
      date: d.date || undefined,
      offsetAccountId: d.offsetAccountId || undefined,
      offsetAccountCode: d.offsetAccountCode || undefined,
    };
  }

  private context(tenantId: string, userId: string, jobId: string, options: ImportOptions): ImportContext {
    return { tenantId, userId, jobId, options };
  }

  /** Runs the importer's validation, skipping rows that already failed to parse. */
  private async check(
    importer: Importer,
    ctx: ImportContext,
    rows: ParsedRow[],
    parseIssues: ImportIssue[],
  ): Promise<ValidationOutcome & { allIssues: ImportIssue[] }> {
    const fileError = parseIssues.some((i) => i.severity === 'error' && i.row === 0);
    const headerRowErrors = parseIssues.some(
      (i) => i.severity === 'error' && ['missing_column', 'duplicate_column'].includes(i.code),
    );
    if (fileError || headerRowErrors) {
      return { planned: [], issues: [], allIssues: parseIssues };
    }
    const badRows = new Set(parseIssues.filter((i) => i.severity === 'error').map((i) => i.row));
    const outcome = await importer.validate(
      ctx,
      rows.filter((r) => !badRows.has(r.rowNumber)),
    );
    return Object.assign(outcome, { allIssues: [...parseIssues, ...outcome.issues] });
  }

  private applyOutcome(job: ImportJob, rows: ParsedRow[], outcome: ValidationOutcome & { allIssues: ImportIssue[] }) {
    job.issues = outcome.allIssues.sort((a, b) => a.row - b.row);
    job.totalRows = rows.length;
    const rowsWith = (severity: string) =>
      new Set(job.issues.filter((i) => i.severity === severity && i.row > 0).map((i) => i.row)).size;
    job.errorRows = rowsWith('error');
    job.warningRows = rowsWith('warning');
    job.createCount = outcome.planned.filter((p) => p.action === 'create').length;
    job.updateCount = outcome.planned.filter((p) => p.action === 'update').length;
    job.skipCount = outcome.planned.filter((p) => p.action === 'skip').length;
  }

  private hasErrors(issues: ImportIssue[]): boolean {
    return issues.some((i) => i.severity === 'error');
  }

  /**
   * Runs the writes in a savepoint of the request transaction: a failure rolls
   * back every business row while the job's "failed" status is still saved.
   */
  protected runAtomically<T>(fn: () => Promise<T>): Promise<T> {
    return runInTransaction(fn, { propagation: Propagation.NESTED });
  }

  private strip(job: ImportJob): ImportJob {
    const { rows: _rows, ...rest } = job;
    return rest as ImportJob;
  }
}
