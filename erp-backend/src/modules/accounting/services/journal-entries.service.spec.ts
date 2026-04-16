import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  NotFoundException,
  UnprocessableEntityException,
  ConflictException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JournalEntriesService } from './journal-entries.service';
import { JournalEntry, JournalEntryStatus } from '../entities/journal-entry.entity';
import { JournalLine } from '../entities/journal-line.entity';
import { FiscalYear } from '../entities/fiscal-year.entity';

describe('JournalEntriesService', () => {
  let service: JournalEntriesService;
  let entryRepo: Record<string, jest.Mock>;
  let lineRepo: Record<string, jest.Mock>;
  let fiscalYearRepo: Record<string, jest.Mock>;
  let eventEmitter: Record<string, jest.Mock>;

  const mockEntry = {
    id: 'entry-1',
    tenantId: 'tenant-1',
    journalId: 'journal-1',
    refNumber: 'JE-000001',
    date: '2024-01-15',
    description: 'Test entry',
    status: JournalEntryStatus.DRAFT,
    createdBy: 'user-1',
    currencyId: 'curr-1',
    exchangeRate: 1,
    postedAt: null,
    lines: [
      { accountId: 'acc-1', debit: 1000, credit: 0, description: 'Debit line' },
      { accountId: 'acc-2', debit: 0, credit: 1000, description: 'Credit line' },
    ],
  };

  beforeEach(async () => {
    entryRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((dto) => dto),
      save: jest.fn((entity) => ({ id: 'entry-1', ...entity })),
      count: jest.fn().mockResolvedValue(0),
    };
    lineRepo = {
      create: jest.fn((dto) => dto),
    };
    fiscalYearRepo = {
      findOne: jest.fn(),
    };
    eventEmitter = {
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JournalEntriesService,
        { provide: getRepositoryToken(JournalEntry), useValue: entryRepo },
        { provide: getRepositoryToken(JournalLine), useValue: lineRepo },
        { provide: getRepositoryToken(FiscalYear), useValue: fiscalYearRepo },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get<JournalEntriesService>(JournalEntriesService);
  });

  describe('create', () => {
    const createDto = {
      journalId: 'journal-1',
      date: '2024-01-15',
      description: 'Test entry',
      currencyId: 'curr-1',
      exchangeRate: 1,
      lines: [
        { accountId: 'acc-1', debit: 1000, credit: 0, description: 'Debit' },
        { accountId: 'acc-2', debit: 0, credit: 1000, description: 'Credit' },
      ],
    };

    it('should create a journal entry with balanced lines', async () => {
      const result = await service.create('tenant-1', 'user-1', createDto);

      expect(entryRepo.save).toHaveBeenCalled();
      expect(result).toHaveProperty('refNumber', 'JE-000001');
      expect(result).toHaveProperty('status', JournalEntryStatus.DRAFT);
    });

    it('should generate sequential ref numbers', async () => {
      entryRepo.count.mockResolvedValue(42);

      const result = await service.create('tenant-1', 'user-1', createDto);

      expect(result).toHaveProperty('refNumber', 'JE-000043');
    });

    it('should throw UnprocessableEntityException if debits != credits', async () => {
      const unbalancedDto = {
        ...createDto,
        lines: [
          { accountId: 'acc-1', debit: 1000, credit: 0, description: 'Debit' },
          { accountId: 'acc-2', debit: 0, credit: 500, description: 'Credit' },
        ],
      };

      await expect(service.create('tenant-1', 'user-1', unbalancedDto)).rejects.toThrow(
        UnprocessableEntityException,
      );
    });
  });

  describe('findAll', () => {
    it('should return all entries for tenant ordered by date desc', async () => {
      entryRepo.find.mockResolvedValue([mockEntry]);

      const result = await service.findAll('tenant-1');

      expect(entryRepo.find).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        relations: ['lines'],
        order: { createdAt: 'DESC' },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('findById', () => {
    it('should return an entry by id', async () => {
      entryRepo.findOne.mockResolvedValue(mockEntry);

      const result = await service.findById('tenant-1', 'entry-1');

      expect(result).toEqual(mockEntry);
    });

    it('should throw NotFoundException if entry not found', async () => {
      entryRepo.findOne.mockResolvedValue(null);

      await expect(service.findById('tenant-1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('post', () => {
    it('should post a draft entry and emit event', async () => {
      entryRepo.findOne.mockResolvedValue({ ...mockEntry });
      fiscalYearRepo.findOne.mockResolvedValue({ id: 'fy-1', status: 'open' });

      const result = await service.post('tenant-1', 'user-1', 'entry-1');

      expect(entryRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: JournalEntryStatus.POSTED }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith('journal.posted', expect.anything());
    });

    it('should throw ConflictException if entry is not draft', async () => {
      entryRepo.findOne.mockResolvedValue({
        ...mockEntry,
        status: JournalEntryStatus.POSTED,
      });

      await expect(service.post('tenant-1', 'user-1', 'entry-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw ConflictException if no open fiscal year', async () => {
      entryRepo.findOne.mockResolvedValue({ ...mockEntry });
      fiscalYearRepo.findOne.mockResolvedValue(null);

      await expect(service.post('tenant-1', 'user-1', 'entry-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('reverse', () => {
    it('should create a reversing entry with swapped debits/credits', async () => {
      const postedEntry = {
        ...mockEntry,
        status: JournalEntryStatus.POSTED,
        lines: [
          { accountId: 'acc-1', debit: 1000, credit: 0, costCenterId: null, branchId: null },
          { accountId: 'acc-2', debit: 0, credit: 1000, costCenterId: null, branchId: null },
        ],
      };
      entryRepo.findOne.mockResolvedValue(postedEntry);
      entryRepo.count.mockResolvedValue(1);

      await service.reverse('tenant-1', 'user-1', 'entry-1');

      expect(entryRepo.save).toHaveBeenCalled();
    });

    it('should throw ConflictException if entry is not posted', async () => {
      entryRepo.findOne.mockResolvedValue({ ...mockEntry, status: JournalEntryStatus.DRAFT });

      await expect(service.reverse('tenant-1', 'user-1', 'entry-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });
});
