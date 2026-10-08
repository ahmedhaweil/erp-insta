import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { HrPaymentSourceService } from './hr-payment-source.service';
import { HrPaymentMethod } from '../entities/employee-loan.entity';
import { JournalType } from '@modules/accounting/entities/journal.entity';

describe('HrPaymentSourceService', () => {
  const setup = (treasury: any, balance = 0, allPermission = false) => {
    const repo = {
      findOne: jest.fn(async () => treasury),
      query: jest.fn(async () => [{ balance }]),
    };
    const rbac = { hasPermission: jest.fn(async () => allPermission) };
    return new HrPaymentSourceService(repo as any, rbac as any);
  };
  const dto = (treasuryId?: string) => ({ paymentMethod: HrPaymentMethod.BANK, treasuryId, date: '2026-10-31' });

  it('uses the default cash/bank account of the settings without a treasury', async () => {
    const source = await setup(null).resolve('t', 'u', { ...dto(), paymentMethod: HrPaymentMethod.CASH }, 100);
    expect(source).toEqual({ journalType: JournalType.CASH, settingsKey: 'cashAccountId' });
    expect(HrPaymentSourceService.account(source, (k) => `acc:${k}`)).toBe('acc:cashAccountId');
  });

  it("pays from the chosen treasury's account", async () => {
    const source = await setup({ id: 'tr', code: 'BNK', type: 'bank', accountId: 'acc-bank', isActive: true }).resolve('t', 'u', dto('tr'), 100);
    expect(source).toMatchObject({ journalType: JournalType.BANK, accountId: 'acc-bank', treasuryId: 'tr' });
    expect(HrPaymentSourceService.account(source, () => 'unused')).toBe('acc-bank');
  });

  it('refuses unknown, inactive and foreign-currency treasuries', async () => {
    await expect(setup(null).resolve('t', 'u', dto('x'), 1)).rejects.toThrow(NotFoundException);
    await expect(setup({ id: 'x', isActive: false }).resolve('t', 'u', dto('x'), 1)).rejects.toThrow(NotFoundException);
    await expect(
      setup({ id: 'x', code: 'USD', type: 'bank', currencyId: 'usd', isActive: true }).resolve('t', 'u', dto('x'), 1),
    ).rejects.toThrow(BadRequestException);
  });

  it('applies the treasury rules: custodians only and no negative cash', async () => {
    const box = { id: 'c', code: 'BOX', type: 'cash', accountId: 'acc-box', isActive: true, custodianUserId: 'cashier' };
    await expect(setup(box, 1000).resolve('t', 'someone-else', dto('c'), 10)).rejects.toThrow(ForbiddenException);
    await expect(setup(box, 50).resolve('t', 'cashier', dto('c'), 80)).rejects.toThrow(BadRequestException);
    await expect(setup(box, 100).resolve('t', 'cashier', dto('c'), 80)).resolves.toMatchObject({ accountId: 'acc-box' });
  });
});
