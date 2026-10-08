import { BadRequestException, ConflictException } from '@nestjs/common';
import { DataImportService } from './data-import.service';
import { ImportEntity, ImportJobStatus } from '../entities/import-job.entity';

describe('DataImportService', () => {
  let jobRepo: any;
  let importer: any;
  let service: DataImportService;
  let stored: any;

  const csv = (text: string) => ({ originalname: 'c.csv', size: text.length, buffer: Buffer.from(text) });

  beforeEach(() => {
    stored = null;
    const qb = {
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn(async () => stored),
    };
    jobRepo = {
      create: jest.fn((x) => ({ ...x })),
      save: jest.fn(async (x) => {
        stored = { id: 'job-1', ...x };
        Object.assign(x, { id: 'job-1' });
        return x;
      }),
      createQueryBuilder: jest.fn(() => qb),
    };
    importer = {
      entity: ImportEntity.CUSTOMERS,
      title: { en: 'Customers', ar: 'العملاء' },
      columns: [
        { key: 'code', label: { en: 'Code', ar: 'الكود' }, required: true },
        { key: 'nameAr', label: { en: 'Arabic name', ar: 'الاسم العربي' }, required: true },
      ],
      validate: jest.fn(async (_ctx: any, rows: any[]) => ({
        planned: rows.map((row) => ({ row, action: 'create', data: {} })),
        issues: [],
      })),
      commit: jest.fn().mockResolvedValue({ created: 2 }),
    };
    const other = (entity: ImportEntity) => ({ entity, columns: [], title: { en: '', ar: '' } });
    service = new DataImportService(
      jobRepo,
      other(ImportEntity.PRODUCTS) as any,
      importer,
      other(ImportEntity.SUPPLIERS) as any,
      other(ImportEntity.ACCOUNTS) as any,
      other(ImportEntity.EMPLOYEES) as any,
      other(ImportEntity.OPENING_STOCK) as any,
      other(ImportEntity.OPENING_CUSTOMER_BALANCES) as any,
      other(ImportEntity.OPENING_SUPPLIER_BALANCES) as any,
    );
    jest.spyOn(service as any, 'runAtomically').mockImplementation((fn: any) => fn());
  });

  it('validates an upload without committing and counts the planned rows', async () => {
    const report = await service.upload('t1', 'u1', ImportEntity.CUSTOMERS, csv('code,nameAr\nC1,أ\nC2,ب\n'));
    expect(report.job.status).toBe(ImportJobStatus.VALIDATED);
    expect(report.job.createCount).toBe(2);
    expect((report.job as any).rows).toBeUndefined();
    expect(importer.commit).not.toHaveBeenCalled();
  });

  it('marks files with parse errors invalid and refuses to commit them', async () => {
    const report = await service.upload('t1', 'u1', ImportEntity.CUSTOMERS, csv('code,nameAr\nC1,\n'));
    expect(report.job.status).toBe(ImportJobStatus.INVALID);
    expect(report.job.errorRows).toBe(1);
    // rows with parse errors are not passed to the importer
    expect(importer.validate.mock.calls[0][1]).toEqual([]);
    await expect(service.commit('t1', 'u1', 'job-1')).rejects.toThrow(BadRequestException);
  });

  it('rejects unsupported files', async () => {
    await expect(
      service.upload('t1', 'u1', ImportEntity.CUSTOMERS, { originalname: 'a.pdf', size: 3, buffer: Buffer.from('abc') }),
    ).rejects.toThrow(BadRequestException);
    await expect(service.upload('t1', 'u1', ImportEntity.CUSTOMERS, undefined)).rejects.toThrow(BadRequestException);
  });

  it('commits a validated job once', async () => {
    await service.upload('t1', 'u1', ImportEntity.CUSTOMERS, csv('code,nameAr\nC1,أ\n'));
    const report = await service.commit('t1', 'u2', 'job-1');
    expect(report.job.status).toBe(ImportJobStatus.COMMITTED);
    expect(report.job.result).toEqual({ created: 2 });
    expect(report.job.committedBy).toBe('u2');
    await expect(service.commit('t1', 'u2', 'job-1')).rejects.toThrow(ConflictException);
  });

  it('re-validates at commit time and writes nothing when the data changed', async () => {
    await service.upload('t1', 'u1', ImportEntity.CUSTOMERS, csv('code,nameAr\nC1,أ\n'));
    importer.validate.mockResolvedValueOnce({
      planned: [],
      issues: [{ row: 2, severity: 'error', code: 'not_found', message: 'gone' }],
    });
    const report = await service.commit('t1', 'u1', 'job-1');
    expect(report.job.status).toBe(ImportJobStatus.FAILED);
    expect(importer.commit).not.toHaveBeenCalled();
  });

  it('records a failure inside the commit (rolled back savepoint) on the job', async () => {
    await service.upload('t1', 'u1', ImportEntity.CUSTOMERS, csv('code,nameAr\nC1,أ\n'));
    importer.commit.mockRejectedValueOnce(new Error('boom'));
    const report = await service.commit('t1', 'u1', 'job-1');
    expect(report.job.status).toBe(ImportJobStatus.FAILED);
    expect(report.job.result).toEqual({ error: 'boom' });
    expect(jobRepo.save).toHaveBeenCalledTimes(3);
  });

  it('builds templates and error files', async () => {
    const tpl = await service.template(ImportEntity.CUSTOMERS);
    expect(tpl.filename).toBe('customers-template.xlsx');
    expect(tpl.buffer.subarray(0, 2).toString()).toBe('PK');
    await service.upload('t1', 'u1', ImportEntity.CUSTOMERS, csv('code,nameAr\nC1,\n'));
    const errors = await service.errorFile('t1', 'job-1');
    expect(errors.buffer.length).toBeGreaterThan(100);
  });
});
