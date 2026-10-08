import { BadRequestException } from '@nestjs/common';
import { BankReconciliationService } from './bank-reconciliation.service';
import { LedgerLine } from './treasury-ledger.service';
import { TreasuryType } from '../entities/treasury.entity';

const ledgerLine = (over: Partial<LedgerLine>): LedgerLine => ({
  journalLineId: 'jl',
  entryId: 'je',
  refNumber: 'JE-000001',
  date: '2026-03-01',
  description: '',
  sourceType: null,
  sourceId: null,
  debit: 0,
  credit: 0,
  amount: 0,
  statementLineId: null,
  ...over,
});

describe('BankReconciliationService', () => {
  describe('parseCsv', () => {
    it('reads signed amounts', () => {
      const lines = BankReconciliationService.parseCsv(
        'Date,Description,Reference,Amount\n2026-03-01,"Deposit, branch 3",DEP1,1500\n2026-03-02,Charges,,-12.5',
      );
      expect(lines).toEqual([
        { date: '2026-03-01', description: 'Deposit, branch 3', reference: 'DEP1', amount: 1500 },
        { date: '2026-03-02', description: 'Charges', reference: undefined, amount: -12.5 },
      ]);
    });

    it('reads debit/credit columns (debit = withdrawal)', () => {
      const lines = BankReconciliationService.parseCsv(
        'date;details;debit;credit\n2026-03-01;Cheque 1001;;5,000.00\n2026-03-03;Transfer out;250;',
      );
      expect(lines.map((l) => l.amount)).toEqual([5000, -250]);
    });

    it('rejects a bad date', () => {
      expect(() => BankReconciliationService.parseCsv('date,amount\n03/01/2026,5')).toThrow(
        BadRequestException,
      );
    });
  });

  describe('findMatches', () => {
    it('matches by amount within the tolerance, preferring the reference, then the closest date', () => {
      const statement = [
        { id: 's1', date: '2026-03-05', amount: 1000, reference: 'CHQ1001', description: '' },
        { id: 's2', date: '2026-03-06', amount: 1000, reference: null as any, description: '' },
        { id: 's3', date: '2026-03-07', amount: -40, reference: null as any, description: 'fee' },
      ];
      const ledger = [
        ledgerLine({ journalLineId: 'a', date: '2026-03-05', amount: 1000, description: 'x' }),
        ledgerLine({
          journalLineId: 'b',
          date: '2026-03-01',
          amount: 1000,
          description: 'Collection of cheque CHQ1001',
        }),
        ledgerLine({ journalLineId: 'c', date: '2026-01-01', amount: -40 }),
      ];
      const pairs = BankReconciliationService.findMatches(statement, ledger, 7);
      expect(pairs.map(([s, l]) => [s, l.journalLineId])).toEqual([
        ['s1', 'b'],
        ['s2', 'a'],
      ]);
    });

    it('never uses a ledger line twice', () => {
      const statement = [
        { id: 's1', date: '2026-03-05', amount: 10, reference: null as any, description: '' },
        { id: 's2', date: '2026-03-05', amount: 10, reference: null as any, description: '' },
      ];
      const pairs = BankReconciliationService.findMatches(
        statement,
        [ledgerLine({ journalLineId: 'a', date: '2026-03-05', amount: 10 })],
        3,
      );
      expect(pairs).toHaveLength(1);
    });
  });

  describe('import and report', () => {
    let service: BankReconciliationService;
    let statement: any;
    const treasury = {
      id: 'bank',
      code: 'NBE',
      type: TreasuryType.BANK,
      accountId: 'acc-bank',
      isActive: true,
    };
    const ledger = { lines: jest.fn(), balance: jest.fn() };

    beforeEach(() => {
      statement = null;
      const statementRepo = {
        create: jest.fn((s) => s),
        save: jest.fn(async (s) => (statement = { id: 'st-1', ...s })),
        findOne: jest.fn(async () => statement),
        find: jest.fn(async () => [statement]),
      };
      const lineRepo = {
        create: jest.fn((l) => ({ id: `line-${l.date}-${l.amount}`, ...l })),
        find: jest.fn(async () => statement.lines.filter((l: any) => !l.isMatched)),
      };
      const matchRepo = { find: jest.fn(async () => []) };
      ledger.lines.mockReset().mockResolvedValue([]);
      ledger.balance.mockReset();
      service = new BankReconciliationService(
        statementRepo as any,
        lineRepo as any,
        matchRepo as any,
        {
          getActive: jest.fn().mockResolvedValue(treasury),
          findById: jest.fn().mockResolvedValue(treasury),
        } as any,
        ledger as any,
        {} as any,
        {} as any,
      );
    });

    it('rejects a statement whose lines do not add up to the closing balance', async () => {
      await expect(
        service.import('t1', 'u1', {
          treasuryId: 'bank',
          openingBalance: 100,
          closingBalance: 500,
          lines: [{ date: '2026-03-01', amount: 300 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('derives dates and closing balance from the lines', async () => {
      const result = await service.import('t1', 'u1', {
        treasuryId: 'bank',
        openingBalance: 100,
        lines: [
          { date: '2026-03-09', amount: -20 },
          { date: '2026-03-01', amount: 300 },
        ],
      });
      expect(result).toMatchObject({
        startDate: '2026-03-01',
        endDate: '2026-03-09',
        closingBalance: 380,
      });
    });

    it('report: book + unmatched bank items = bank + outstanding book items', async () => {
      await service.import('t1', 'u1', {
        treasuryId: 'bank',
        openingBalance: 0,
        lines: [
          { date: '2026-03-01', amount: 1000 },
          { date: '2026-03-31', amount: -15 },
        ],
      });
      statement.lines[0].isMatched = true;
      // Book: 1000 deposit (matched) + 200 deposit in transit - 300 unpresented cheque
      ledger.balance
        .mockResolvedValueOnce({ balance: 900, baseBalance: 900 })
        .mockResolvedValueOnce({ balance: 0, baseBalance: 0 });
      ledger.lines.mockResolvedValue([
        ledgerLine({ journalLineId: 'dit', amount: 200 }),
        ledgerLine({ journalLineId: 'chq', amount: -300 }),
      ]);
      const report = await service.report('t1', 'st-1');
      expect(report).toMatchObject({
        bookBalance: 900,
        statementBalance: 985,
        totalDepositsInTransit: 200,
        totalOutstandingPayments: -300,
        totalUnmatchedStatementLines: -15,
        adjustedBankBalance: 885,
        adjustedBookBalance: 885,
        difference: 0,
        isReconciled: false,
      });
    });
  });
});
