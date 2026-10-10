import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  CREDIT_OVERRIDE_PERMISSION,
  CustomerCreditService,
  assertCustomerNotBlocked,
  evaluateCredit,
} from './customer-credit.service';

describe('CustomerCreditService', () => {
  let categoryRepo: { findOne: jest.Mock };
  let rbac: { hasPermission: jest.Mock };
  let service: CustomerCreditService;

  const customer = (patch: any = {}) =>
    ({ id: 'c1', balance: 800, creditLimit: 1000, balanceWarningThreshold: null, categoryId: null, ...patch }) as any;

  beforeEach(() => {
    categoryRepo = { findOne: jest.fn() };
    rbac = { hasPermission: jest.fn().mockResolvedValue(false) };
    service = new CustomerCreditService(categoryRepo as any, rbac as any);
  });

  it('evaluates the hard limit and the soft threshold', () => {
    expect(evaluateCredit(customer(), 200, 900)).toEqual({
      exposure: 1000,
      limitExceeded: false,
      warning: expect.stringContaining('warning threshold'),
    });
    expect(evaluateCredit(customer(), 201).limitExceeded).toBe(true);
    expect(evaluateCredit(customer({ creditLimit: 0 }), 1e9).limitExceeded).toBe(false);
  });

  it('returns a warning (not an error) above the customer threshold', async () => {
    const warnings = await service.check('t1', 'u1', customer({ balanceWarningThreshold: 850 }), 100, 'Invoice');
    expect(warnings).toHaveLength(1);
  });

  it('falls back to the category threshold', async () => {
    categoryRepo.findOne.mockResolvedValue({ balanceWarningThreshold: 500 });
    const warnings = await service.check('t1', 'u1', customer({ categoryId: 'cat' }), 10, 'Invoice');
    expect(categoryRepo.findOne).toHaveBeenCalled();
    expect(warnings[0]).toContain('500.00');
  });

  it('blocks above the credit limit without the override permission', async () => {
    await expect(service.check('t1', 'u1', customer(), 300, 'Invoice')).rejects.toThrow(ForbiddenException);
    expect(rbac.hasPermission).toHaveBeenCalledWith('t1', 'u1', CREDIT_OVERRIDE_PERMISSION);
  });

  it('lets users holding the override exceed the limit with a warning', async () => {
    rbac.hasPermission.mockResolvedValue(true);
    const warnings = await service.check('t1', 'u1', customer(), 300, 'Invoice');
    expect(warnings[0]).toContain('overridden');
  });

  it('refuses blocked customers with their reason', async () => {
    expect(() => assertCustomerNotBlocked({ isBlocked: true, blockReason: 'bad cheques' })).toThrow(
      'Customer is blocked: bad cheques',
    );
    await expect(
      service.check('t1', 'u1', customer({ isBlocked: true }), 1, 'Invoice'),
    ).rejects.toThrow(BadRequestException);
  });

  it('keeps the legacy hard block when not wired', () => {
    expect(() => CustomerCreditService.checkWithoutOverride(customer(), 300, 'Order')).toThrow(
      BadRequestException,
    );
  });
});
