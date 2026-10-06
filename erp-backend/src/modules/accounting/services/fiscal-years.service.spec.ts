import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { FiscalYearsService } from './fiscal-years.service';
import { AutoPostingService } from './auto-posting.service';
import { FiscalYear } from '../entities/fiscal-year.entity';
import { JournalEntry } from '../entities/journal-entry.entity';
import { JournalLine } from '../entities/journal-line.entity';

describe('FiscalYearsService', () => {
  let service: FiscalYearsService;
  let yearRepo: Record<string, jest.Mock>;
  let entryRepo: Record<string, jest.Mock>;
  let balances: any[];
  let autoPosting: { post: jest.Mock };

  const year = () => ({
    id: 'fy',
    name: 'FY2025',
    startDate: '2025-01-01',
    endDate: '2025-12-31',
    status: 'open',
  });

  beforeEach(async () => {
    balances = [];
    yearRepo = {
      findOne: jest.fn(),
      save: jest.fn((y) => y),
      create: jest.fn((y) => y),
    };
    entryRepo = { count: jest.fn().mockResolvedValue(0) };
    const qb: any = {};
    for (const m of ['innerJoin', 'select', 'addSelect', 'where', 'andWhere', 'groupBy'])
      qb[m] = jest.fn(() => qb);
    qb.getRawMany = jest.fn(async () => balances);
    autoPosting = { post: jest.fn(async () => ({ id: 'je-close' })) };

    const module = await Test.createTestingModule({
      providers: [
        FiscalYearsService,
        { provide: getRepositoryToken(FiscalYear), useValue: yearRepo },
        { provide: getRepositoryToken(JournalEntry), useValue: entryRepo },
        { provide: getRepositoryToken(JournalLine), useValue: { createQueryBuilder: () => qb } },
        { provide: AutoPostingService, useValue: autoPosting },
      ],
    }).compile();
    service = module.get(FiscalYearsService);
  });

  it('rejects overlapping fiscal years', async () => {
    yearRepo.findOne.mockResolvedValue(year());
    await expect(
      service.create('t1', { name: 'FY2025b', startDate: '2025-06-01', endDate: '2026-05-31' }),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects inverted dates', async () => {
    await expect(
      service.create('t1', { name: 'bad', startDate: '2025-12-31', endDate: '2025-01-01' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses to close while draft entries remain', async () => {
    yearRepo.findOne.mockResolvedValue(year());
    entryRepo.count.mockResolvedValue(2);
    await expect(service.close('t1', 'u1', 'fy')).rejects.toThrow(ConflictException);
  });

  it('moves the result to retained earnings and closes the year', async () => {
    yearRepo.findOne.mockResolvedValue(year());
    balances = [
      { accountId: 'revenue', balance: '-1000' },
      { accountId: 'expense', balance: '600' },
    ];

    const result = await service.close('t1', 'u1', 'fy');

    const lines = autoPosting.post.mock.calls[0][0].buildLines({}, (k: string) => k);
    expect(lines).toEqual([
      { accountId: 'revenue', debit: 1000 },
      { accountId: 'expense', credit: 600 },
      { accountId: 'retainedEarningsAccountId', credit: 400 },
    ]);
    expect(result.netIncome).toBe(400);
    expect(result.fiscalYear.status).toBe('closed');
  });
});
