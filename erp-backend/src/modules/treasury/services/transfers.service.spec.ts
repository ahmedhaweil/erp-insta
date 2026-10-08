import { BadRequestException } from '@nestjs/common';
import { TransfersService } from './transfers.service';
import { Treasury, TreasuryType } from '../entities/treasury.entity';
import { TransferStatus, TreasuryTransfer } from '../entities/treasury-transfer.entity';

const treasury = (over: Partial<Treasury>): Treasury =>
  ({
    id: 'x',
    code: 'X',
    type: TreasuryType.BANK,
    accountId: 'acc-x',
    currencyId: null,
    isActive: true,
    ...over,
  }) as Treasury;

describe('TransfersService', () => {
  const cash = treasury({ id: 'cash', type: TreasuryType.CASH, accountId: 'acc-cash' });
  const bank = treasury({ id: 'bank', accountId: 'acc-bank' });
  const usdBank = treasury({ id: 'usd', accountId: 'acc-usd', currencyId: 'usd' });
  const eurBank = treasury({ id: 'eur', accountId: 'acc-eur', currencyId: 'eur' });

  describe('computeAmounts', () => {
    it('same currency: amounts are equal and rate 1', () => {
      expect(TransfersService.computeAmounts(cash, bank, { amount: 500, fee: 5 })).toEqual({
        amount: 500,
        fee: 5,
        rate: 1,
        toAmount: 500,
        baseRate: 1,
      });
    });

    it('same currency with a different destination amount is refused', () => {
      expect(() => TransfersService.computeAmounts(cash, bank, { amount: 500, toAmount: 400 })).toThrow(
        BadRequestException,
      );
    });

    it('base -> foreign needs a rate and derives the received amount', () => {
      expect(() => TransfersService.computeAmounts(bank, usdBank, { amount: 4800 })).toThrow(
        BadRequestException,
      );
      const v = TransfersService.computeAmounts(bank, usdBank, { amount: 4800, toAmount: 100 });
      expect(v).toMatchObject({ toAmount: 100, rate: 0.02083333, baseRate: 1 });
    });

    it('foreign -> base uses the transfer rate as base rate', () => {
      const v = TransfersService.computeAmounts(usdBank, bank, { amount: 100, rate: 48.5 });
      expect(v).toMatchObject({ toAmount: 4850, rate: 48.5, baseRate: 48.5 });
    });

    it('foreign -> foreign requires the base rate', () => {
      expect(() => TransfersService.computeAmounts(usdBank, eurBank, { amount: 100, rate: 0.9 })).toThrow(
        BadRequestException,
      );
      const v = TransfersService.computeAmounts(usdBank, eurBank, {
        amount: 100,
        rate: 0.9,
        baseRate: 48,
      });
      expect(v).toMatchObject({ toAmount: 90, baseRate: 48 });
    });
  });

  describe('postingLines', () => {
    const transfer = (over: Partial<TreasuryTransfer>) =>
      ({
        transferNumber: 'TRF-000001',
        amount: 100,
        toAmount: 100,
        rate: 1,
        baseRate: 1,
        fee: 0,
        status: TransferStatus.DRAFT,
        ...over,
      }) as TreasuryTransfer;

    it('cash deposit with a bank fee', () => {
      const lines = TransfersService.postingLines(
        transfer({ amount: 1000, toAmount: 1000, fee: 10 }),
        cash,
        bank,
        'acc-charges',
      );
      expect(lines).toEqual([
        expect.objectContaining({ accountId: 'acc-bank', debit: 1000, amountCurrency: undefined }),
        expect.objectContaining({ accountId: 'acc-charges', debit: 10 }),
        expect.objectContaining({ accountId: 'acc-cash', credit: 1010, amountCurrency: undefined }),
      ]);
    });

    it('foreign to base keeps the foreign amount on the source line', () => {
      const lines = TransfersService.postingLines(
        transfer({ amount: 100, toAmount: 4850, rate: 48.5, baseRate: 48.5, fee: 1 }),
        usdBank,
        bank,
        'acc-charges',
      );
      expect(lines).toEqual([
        expect.objectContaining({ accountId: 'acc-bank', debit: 4850 }),
        expect.objectContaining({ accountId: 'acc-charges', debit: 48.5 }),
        expect.objectContaining({ accountId: 'acc-usd', credit: 4898.5, amountCurrency: -101 }),
      ]);
      const debit = lines.reduce((s, l) => s + (l.debit ?? 0), 0);
      const credit = lines.reduce((s, l) => s + (l.credit ?? 0), 0);
      expect(debit).toBeCloseTo(credit, 2);
    });

    it('foreign to foreign stores each side in its own currency', () => {
      const lines = TransfersService.postingLines(
        transfer({ amount: 100, toAmount: 90, rate: 0.9, baseRate: 48 }),
        usdBank,
        eurBank,
      );
      expect(lines).toEqual([
        expect.objectContaining({ accountId: 'acc-eur', debit: 4800, amountCurrency: 90 }),
        expect.objectContaining({ accountId: 'acc-usd', credit: 4800, amountCurrency: -100 }),
      ]);
    });
  });

  describe('lifecycle', () => {
    let service: TransfersService;
    let stored: any;
    let autoPosting: Record<string, jest.Mock>;
    const treasuries = { getActive: jest.fn(), findById: jest.fn() };
    const ledger = { assertNotReconciled: jest.fn() };

    beforeEach(() => {
      stored = null;
      const repo = {
        create: jest.fn((t) => t),
        save: jest.fn(async (t) => (stored = { id: 'trf-1', ...stored, ...t })),
        findOne: jest.fn(async () => stored),
      };
      autoPosting = { post: jest.fn(), preflight: jest.fn() };
      const byId = (_t: string, id: string) => (id === 'cash' ? cash : bank);
      treasuries.getActive.mockImplementation(async (t, id) => byId(t, id));
      treasuries.findById.mockImplementation(async (t, id) => byId(t, id));
      service = new TransfersService(
        repo as any,
        treasuries as any,
        ledger as any,
        autoPosting as any,
        { next: jest.fn().mockResolvedValue('TRF-000001') } as any,
      );
    });

    it('refuses a transfer to the same treasury', async () => {
      await expect(
        service.create('t1', 'u1', {
          fromTreasuryId: 'cash',
          toTreasuryId: 'cash',
          amount: 1,
          date: '2026-03-01',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('posts on creation and mirrors the entry on cancel', async () => {
      const posted = await service.create('t1', 'u1', {
        fromTreasuryId: 'cash',
        toTreasuryId: 'bank',
        amount: 300,
        fee: 2,
        date: '2026-03-01',
        post: true,
      });
      expect(posted.status).toBe(TransferStatus.POSTED);
      expect(autoPosting.preflight).toHaveBeenCalledWith('t1', '2026-03-01', ['bankChargesAccountId']);

      const cancelled = await service.cancel('t1', 'u1', 'trf-1', { date: '2026-03-02' });
      expect(cancelled.status).toBe(TransferStatus.CANCELLED);
      expect(ledger.assertNotReconciled).toHaveBeenCalledWith('t1', 'treasury_transfer', 'trf-1');
      const reversal = autoPosting.post.mock.calls[1][0];
      expect(reversal.date).toBe('2026-03-02');
      const lines = reversal.buildLines({}, (k: string) => k);
      expect(lines).toEqual([
        expect.objectContaining({ accountId: 'acc-bank', credit: 300 }),
        expect.objectContaining({ accountId: 'bankChargesAccountId', credit: 2 }),
        expect.objectContaining({ accountId: 'acc-cash', debit: 302 }),
      ]);
    });
  });
});
