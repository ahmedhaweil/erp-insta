import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { AutoPostingService } from './auto-posting.service';
import { AccountingSettingsService } from './accounting-settings.service';
import { JournalEntriesService } from './journal-entries.service';
import { Journal, JournalType } from '../entities/journal.entity';

describe('AutoPostingService', () => {
  let service: AutoPostingService;
  let settings: { find: jest.Mock };
  let entries: { createAndPost: jest.Mock; findBySource: jest.Mock; reverse: jest.Mock };
  let journalRepo: Record<string, jest.Mock>;

  const request = (lines: any[]) => ({
    tenantId: 't1',
    userId: 'u1',
    journalType: JournalType.SALE,
    date: '2026-01-10',
    description: 'Invoice INV-1',
    sourceType: 'sales_invoice',
    sourceId: 'inv-1',
    buildLines: jest.fn((_s: any, account: any) =>
      lines.map((l) => ({ ...l, accountId: account(l.accountId) })),
    ),
  });

  beforeEach(async () => {
    settings = { find: jest.fn() };
    entries = {
      createAndPost: jest.fn(async (_t, _u, dto) => ({ id: 'je-1', ...dto })),
      findBySource: jest.fn(),
      reverse: jest.fn(),
    };
    journalRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'jr-sale', type: JournalType.SALE }),
      create: jest.fn((j) => j),
      save: jest.fn((j) => ({ id: 'jr-new', ...j })),
    };
    const module = await Test.createTestingModule({
      providers: [
        AutoPostingService,
        { provide: AccountingSettingsService, useValue: settings },
        { provide: JournalEntriesService, useValue: entries },
        { provide: getRepositoryToken(Journal), useValue: journalRepo },
      ],
    }).compile();
    service = module.get(AutoPostingService);
  });

  it('skips posting when the tenant has not enabled accounting', async () => {
    settings.find.mockResolvedValue(null);
    const result = await service.post(request([{ accountId: 'receivableAccountId', debit: 10 }]));
    expect(result).toBeNull();
    expect(entries.createAndPost).not.toHaveBeenCalled();
  });

  it('fails loudly when a required default account is missing', async () => {
    settings.find.mockResolvedValue({ receivableAccountId: 'acc-ar' });
    await expect(
      service.post(
        request([
          { accountId: 'receivableAccountId', debit: 10 },
          { accountId: 'salesAccountId', credit: 10 },
        ]),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('merges same-account lines, drops zero lines and posts in the right journal', async () => {
    settings.find.mockResolvedValue({
      receivableAccountId: 'acc-ar',
      salesAccountId: 'acc-rev',
      outputTaxAccountId: 'acc-vat',
    });

    await service.post(
      request([
        { accountId: 'receivableAccountId', debit: 114 },
        { accountId: 'salesAccountId', credit: 60 },
        { accountId: 'salesAccountId', credit: 40 },
        { accountId: 'outputTaxAccountId', credit: 14 },
        { accountId: 'outputTaxAccountId', credit: 0 },
      ]),
    );

    const [, , dto, source] = entries.createAndPost.mock.calls[0];
    expect(dto.journalId).toBe('jr-sale');
    expect(dto.lines).toEqual([
      expect.objectContaining({ accountId: 'acc-ar', debit: 114, credit: 0 }),
      expect.objectContaining({ accountId: 'acc-rev', debit: 0, credit: 100 }),
      expect.objectContaining({ accountId: 'acc-vat', debit: 0, credit: 14 }),
    ]);
    expect(source).toEqual({ sourceType: 'sales_invoice', sourceId: 'inv-1' });
  });

  it('creates a default journal of the requested type when none exists', async () => {
    journalRepo.findOne.mockResolvedValue(null);
    const journal = await service.resolveJournal('t1', JournalType.BANK);
    expect(journal).toEqual(expect.objectContaining({ name: 'Bank', type: JournalType.BANK }));
  });
});
