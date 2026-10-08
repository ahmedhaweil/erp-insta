import { BadRequestException, ConflictException } from '@nestjs/common';
import { VouchersService } from './vouchers.service';
import { TreasuryType } from '../entities/treasury.entity';
import { VoucherStatus, VoucherType } from '../entities/treasury-voucher.entity';

describe('VouchersService', () => {
  let service: VouchersService;
  let stored: any;
  let autoPosting: Record<string, jest.Mock>;
  let ledger: Record<string, jest.Mock>;
  let treasuries: Record<string, jest.Mock>;
  const box = {
    id: 'box',
    code: 'BOX',
    type: TreasuryType.CASH,
    accountId: 'acc-box',
    currencyId: null,
    branchId: 'br-1',
    isActive: true,
  };

  beforeEach(() => {
    stored = null;
    const voucherRepo = {
      create: jest.fn((v) => v),
      save: jest.fn(async (v) => (stored = { id: 'v-1', ...stored, ...v })),
      findOne: jest.fn(async () => stored),
    };
    const lineRepo = { create: jest.fn((l) => l), delete: jest.fn() };
    autoPosting = { post: jest.fn(), preflight: jest.fn(), reverseSource: jest.fn() };
    ledger = { assertNotReconciled: jest.fn() };
    treasuries = {
      getActive: jest.fn().mockResolvedValue(box),
      getUsable: jest.fn().mockResolvedValue(box),
      assertUsable: jest.fn(),
      assertFunds: jest.fn(),
    };
    service = new VouchersService(
      voucherRepo as any,
      lineRepo as any,
      treasuries as any,
      ledger as any,
      autoPosting as any,
      { next: jest.fn().mockResolvedValue('PV-000001') } as any,
    );
  });

  const expenseVoucher = {
    type: VoucherType.PAYMENT,
    treasuryId: 'box',
    date: '2026-03-01',
    description: 'Office supplies',
    lines: [
      { accountId: 'acc-rent', amount: 1000, costCenterId: 'cc-1' },
      { accountId: 'acc-stationery', amount: 50.5 },
    ],
  };

  it('creates a numbered draft with the total of its lines', async () => {
    const voucher = await service.create('t1', 'u1', expenseVoucher);
    expect(voucher).toMatchObject({
      voucherNumber: 'PV-000001',
      status: VoucherStatus.DRAFT,
      amount: 1050.5,
      branchId: 'br-1',
    });
    expect(autoPosting.post).not.toHaveBeenCalled();
  });

  it('a payment voucher debits the lines and credits the treasury', async () => {
    const voucher = await service.create('t1', 'u1', { ...expenseVoucher, post: true });
    expect(voucher.status).toBe(VoucherStatus.POSTED);
    const request = autoPosting.post.mock.calls[0][0];
    expect(request.sourceType).toBe('treasury_voucher');
    expect(request.buildLines()).toEqual([
      expect.objectContaining({ accountId: 'acc-rent', debit: 1000, costCenterId: 'cc-1' }),
      expect.objectContaining({ accountId: 'acc-stationery', debit: 50.5 }),
      expect.objectContaining({ accountId: 'acc-box', credit: 1050.5, branchId: 'br-1' }),
    ]);
  });

  it('a receipt voucher debits the treasury', async () => {
    await service.create('t1', 'u1', {
      ...expenseVoucher,
      type: VoucherType.RECEIPT,
      lines: [{ accountId: 'acc-other-income', amount: 200 }],
      post: true,
    });
    expect(autoPosting.post.mock.calls[0][0].buildLines()).toEqual([
      expect.objectContaining({ accountId: 'acc-box', debit: 200 }),
      expect.objectContaining({ accountId: 'acc-other-income', credit: 200 }),
    ]);
  });

  it('refuses an exchange rate on a base-currency treasury', async () => {
    await expect(service.create('t1', 'u1', { ...expenseVoucher, exchangeRate: 2 })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('cancelling a posted voucher reverses it unless reconciled', async () => {
    await service.create('t1', 'u1', { ...expenseVoucher, post: true });
    const cancelled = await service.cancel('t1', 'u1', 'v-1', { date: '2026-03-05' });
    expect(ledger.assertNotReconciled).toHaveBeenCalledWith('t1', 'treasury_voucher', 'v-1');
    expect(autoPosting.reverseSource).toHaveBeenCalledWith(
      't1',
      'u1',
      'treasury_voucher',
      'v-1',
      '2026-03-05',
    );
    expect(cancelled.status).toBe(VoucherStatus.CANCELLED);
    await expect(service.post('t1', 'u1', 'v-1')).rejects.toThrow(ConflictException);
  });

  it('enforces custodianship and the no-negative rule when posting', async () => {
    await service.create('t1', 'u1', { ...expenseVoucher, post: true });
    expect(treasuries.getUsable).toHaveBeenCalledWith('t1', 'u1', 'box');
    expect(treasuries.assertUsable).toHaveBeenCalledWith('t1', 'u1', box);
    expect(treasuries.assertFunds).toHaveBeenCalledWith('t1', box, 1050.5, '2026-03-01');

    stored = null;
    treasuries.assertFunds.mockClear();
    await service.create('t1', 'u1', {
      ...expenseVoucher,
      type: VoucherType.RECEIPT,
      lines: [{ accountId: 'acc-other-income', amount: 200 }],
      post: true,
    });
    expect(treasuries.assertFunds).not.toHaveBeenCalled();

    stored = null;
    treasuries.assertFunds.mockRejectedValueOnce(new BadRequestException('cannot go negative'));
    await expect(service.create('t1', 'u1', { ...expenseVoucher, post: true })).rejects.toThrow(
      BadRequestException,
    );
    expect(autoPosting.post).toHaveBeenCalledTimes(2);
  });

  it('only drafts can be edited', async () => {
    await service.create('t1', 'u1', { ...expenseVoucher, post: true });
    await expect(service.update('t1', 'v-1', { description: 'x' })).rejects.toThrow(
      ConflictException,
    );
  });
});
