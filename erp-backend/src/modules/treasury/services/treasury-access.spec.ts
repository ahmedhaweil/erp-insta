import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  TREASURY_ALL_PERMISSION,
  assertSufficientFunds,
  canUseTreasury,
  custodiansOf,
  enforceTreasuryRules,
  treasuryAllowsNegative,
} from './treasury-access.util';
import { TreasuriesService } from './treasuries.service';
import { TreasuryType } from '../entities/treasury.entity';

const box = {
  id: 'box',
  code: 'BOX',
  type: TreasuryType.CASH,
  accountId: 'acc-box',
  custodianUserId: 'cashier',
  custodianUserIds: ['deputy'],
  allowNegative: null,
  isActive: true,
} as any;
const bank = { ...box, id: 'bank', code: 'BANK', type: TreasuryType.BANK, custodianUserId: null, custodianUserIds: [] };

describe('treasury access rules', () => {
  it('lists custodians and lets only them (or treasury/treasuries/all) use a restricted treasury', () => {
    expect(custodiansOf(box)).toEqual(['cashier', 'deputy']);
    expect(canUseTreasury(box, 'cashier', false)).toBe(true);
    expect(canUseTreasury(box, 'deputy', false)).toBe(true);
    expect(canUseTreasury(box, 'other', false)).toBe(false);
    expect(canUseTreasury(box, 'other', true)).toBe(true);
    expect(canUseTreasury(bank, 'anyone', false)).toBe(true); // no custodian: open
  });

  it('defaults the negative-balance rule by type and honours the override', () => {
    expect(treasuryAllowsNegative(box)).toBe(false);
    expect(treasuryAllowsNegative(bank)).toBe(true);
    expect(treasuryAllowsNegative({ ...box, allowNegative: true })).toBe(true);
    expect(treasuryAllowsNegative({ ...bank, allowNegative: false })).toBe(false);
  });

  it('refuses an outflow that takes a cash box below zero', () => {
    expect(() => assertSufficientFunds(box, 100, 100)).not.toThrow();
    expect(() => assertSufficientFunds(box, 100, 100.01)).toThrow(BadRequestException);
    expect(() => assertSufficientFunds(bank, 0, 5000)).not.toThrow();
  });

  it('enforces both rules for payments (helper used by the payments module)', async () => {
    const rbac = { hasPermission: jest.fn(async () => false) };
    const query = jest.fn(async () => [{ balance: '50' }]);
    await expect(
      enforceTreasuryRules({ tenantId: 't', userId: 'other', treasury: box, rbac, query, outflow: 10 }),
    ).rejects.toThrow(ForbiddenException);
    expect(rbac.hasPermission).toHaveBeenCalledWith('t', 'other', TREASURY_ALL_PERMISSION);
    await expect(
      enforceTreasuryRules({ tenantId: 't', userId: 'cashier', treasury: box, rbac, query, outflow: 80, date: '2026-10-01' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      enforceTreasuryRules({ tenantId: 't', userId: 'cashier', treasury: box, rbac, query, outflow: 30, date: '2026-10-01' }),
    ).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledTimes(3); // 1 (refused on the overall balance) + 2 (overall and at the date)
    rbac.hasPermission.mockResolvedValue(true);
    await expect(
      enforceTreasuryRules({ tenantId: 't', userId: 'auditor', treasury: box, rbac, query }),
    ).resolves.toBeUndefined();
  });
});

describe('TreasuriesService access', () => {
  const ledger = { balance: jest.fn() };
  const rbac = { hasPermission: jest.fn(async () => false) };
  const repo = { findOne: jest.fn(async () => box), find: jest.fn(async () => [box, bank]) };
  const service = new TreasuriesService(repo as any, {} as any, ledger as any, {} as any, rbac as any);

  beforeEach(() => {
    ledger.balance.mockReset();
    rbac.hasPermission.mockResolvedValue(false);
  });

  it('filters the treasuries a user may use', async () => {
    expect((await service.findAll('t', { usableBy: 'other' })).map((t: any) => t.id)).toEqual(['bank']);
    expect((await service.findAll('t', { usableBy: 'cashier' })).map((t: any) => t.id)).toEqual(['box', 'bank']);
    rbac.hasPermission.mockResolvedValue(true);
    expect((await service.findAll('t', { usableBy: 'other' })).length).toBe(2);
  });

  it('refuses a non-custodian and protects the cash book', async () => {
    await expect(service.getUsable('t', 'other', 'box')).rejects.toThrow(ForbiddenException);
    await expect(service.movements('t', 'box', undefined, undefined, 'other')).rejects.toThrow(ForbiddenException);
    await expect(service.getUsable('t', 'deputy', 'box')).resolves.toBe(box);
  });

  it('checks funds today and at the document date', async () => {
    ledger.balance.mockResolvedValueOnce({ balance: 500 }).mockResolvedValueOnce({ balance: 100 });
    await expect(service.assertFunds('t', box, 200, '2026-09-01')).rejects.toThrow(BadRequestException);
    expect(ledger.balance).toHaveBeenLastCalledWith('t', box, { asOf: '2026-09-01' });
    await service.assertFunds('t', bank, 1e9, '2026-09-01'); // banks may go negative
    expect(ledger.balance).toHaveBeenCalledTimes(2);
  });
});
