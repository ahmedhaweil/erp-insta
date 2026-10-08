import { BadRequestException, ConflictException } from '@nestjs/common';
import { EndOfServiceService } from './end-of-service.service';
import { PayrollCalculator } from '../calculators/payroll-calculator';
import { mergeRules } from '../calculators/payroll-rules';
import { EmployeeStatus, PayrollCountry } from '../entities/employee.entity';
import { EosProvisionStatus } from '../entities/eos-provision.entity';
import { FinalSettlementStatus } from '../entities/final-settlement.entity';
import { HrPaymentMethod } from '../entities/employee-loan.entity';

const ACCOUNTS = {
  eosExpenseAccountId: 'eos-exp',
  eosProvisionAccountId: 'eos-prov',
  martyrsFundAccountId: null,
};
const sum = (lines: any[], side: 'debit' | 'credit') =>
  Math.round(lines.reduce((s, l) => s + (l[side] ?? 0), 0) * 100) / 100;

describe('EndOfServiceService', () => {
  const saudi = {
    id: 'e1',
    code: 'EMP-1',
    hireDate: '2020-01-01',
    terminationDate: null as string | null,
    status: EmployeeStatus.ACTIVE,
    payrollCountry: PayrollCountry.SA,
    basicSalary: 10000,
    allowances: [],
    branchId: 'b1',
    costCenterId: 'cc1',
  };
  let provisions: any[];
  let provisionLines: any[];
  let settlements: any[];
  let autoPosting: Record<string, jest.Mock>;
  let loans: Record<string, jest.Mock>;
  let service: EndOfServiceService;
  let accounts: any;

  beforeEach(() => {
    provisions = [];
    provisionLines = [];
    settlements = [];
    accounts = { ...ACCOUNTS };
    const qb: any = {};
    for (const m of ['where', 'andWhere', 'orderBy']) qb[m] = jest.fn(() => qb);
    qb.getMany = jest.fn(async () => [saudi]);
    autoPosting = { post: jest.fn(), preflight: jest.fn(), reverseSource: jest.fn() };
    loans = {
      outstandingBalance: jest.fn(async () => 3000),
      allocateOutstanding: jest.fn(async (_t, _e, amount) => [{ id: 'i1', loanId: 'l1', amount }]),
      applyRecoveries: jest.fn(),
    };
    const matches = (row: any, where: any) =>
      Object.entries(where).every(([k, v]: [string, any]) =>
        v && typeof v === 'object' && '_value' in v ? v._value.includes(row[k]) : row[k] === v,
      );
    service = new EndOfServiceService(
      {
        find: jest.fn(async ({ where }) => provisions.filter((p) => matches(p, where))),
        findOne: jest.fn(async ({ where }) => provisions.find((p) => matches(p, where)) ?? null),
        create: jest.fn((x) => x),
        save: jest.fn(async (x) => {
          const saved = { id: `p${provisions.length + 1}`, ...x };
          provisions.push(saved);
          for (const l of x.lines ?? []) provisionLines.push({ ...l, provisionId: saved.id });
          return saved;
        }),
        update: jest.fn(async (id, patch) => Object.assign(provisions.find((p) => p.id === id), patch)),
      } as any,
      {
        find: jest.fn(async ({ where }) => provisionLines.filter((l) => matches(l, where))),
        create: jest.fn((x) => x),
      } as any,
      {
        find: jest.fn(async ({ where }) => settlements.filter((s) => matches(s, where))),
        findOne: jest.fn(async ({ where }) => settlements.find((s) => matches(s, where)) ?? null),
        create: jest.fn((x) => x),
        save: jest.fn(async (x) => {
          if (!x.id) {
            x.id = `s${settlements.length + 1}`;
            settlements.push(x);
          }
          return x;
        }),
      } as any,
      { createQueryBuilder: () => qb } as any,
      { find: jest.fn(async () => [{ id: 'lt', code: 'annual', encashable: true, isPaid: true }]) } as any,
      {
        findById: jest.fn(async () => saudi),
        monthlyWage: jest.fn(() => 10000),
      } as any,
      { balanceFor: jest.fn(async () => ({ remaining: 6 })) } as any,
      loans as any,
      {
        getAccounts: jest.fn(async () => accounts),
        getRules: jest.fn(async () => mergeRules({})),
        getCalculator: jest.fn(async () => new PayrollCalculator()),
      } as any,
      { lockedPeriods: jest.fn(async () => []) } as any,
      autoPosting as any,
      { next: jest.fn().mockResolvedValue('FS-000001') } as any,
    );
  });

  it('builds provision lines: increases expensed, decreases released', () => {
    const lines = EndOfServiceService.provisionLines(
      [
        { employeeId: 'a', delta: 500, branchId: 'b1', costCenterId: 'cc1' },
        { employeeId: 'b', delta: -200 },
        { employeeId: 'c', delta: 0 },
      ],
      ACCOUNTS,
    );
    expect(lines).toEqual([
      { accountId: 'eos-exp', debit: 500, branchId: 'b1', costCenterId: 'cc1' },
      { accountId: 'eos-prov', credit: 500, branchId: 'b1' },
      { accountId: 'eos-prov', debit: 200, branchId: undefined },
      { accountId: 'eos-exp', credit: 200, branchId: undefined, costCenterId: undefined },
    ]);
  });

  it('posts the monthly provision as the liability less the booked provision', async () => {
    const first = await service.createProvision('t1', 'u1', { period: '2026-09' });
    // 2020-01-01 .. 2026-09-30 = 2465 days = 6.7534 years:
    // 5 x 0.5 x 10,000 + 1.7534 x 10,000 = 42,534.25
    expect(first.lines[0]).toMatchObject({ liability: 42534.25, booked: 0, delta: 42534.25 });
    const posted = autoPosting.post.mock.calls[0][0].buildLines();
    expect(posted[0]).toMatchObject({ accountId: 'eos-exp', debit: 42534.25, costCenterId: 'cc1' });

    const second = await service.createProvision('t1', 'u1', { period: '2026-10' });
    // 31 more days of the second band: liability 43,383.56 - 42,534.25 booked
    expect(second.lines[0]).toMatchObject({ liability: 43383.56, booked: 42534.25, delta: 849.31 });
  });

  it('refuses a second provision for the month, an earlier month, or missing accounts', async () => {
    await service.createProvision('t1', 'u1', { period: '2026-10' });
    await expect(service.createProvision('t1', 'u1', { period: '2026-10' })).rejects.toThrow(ConflictException);
    await expect(service.createProvision('t1', 'u1', { period: '2026-09' })).rejects.toThrow(ConflictException);
    accounts = { ...ACCOUNTS, eosProvisionAccountId: null };
    await expect(service.createProvision('t1', 'u1', { period: '2026-11' })).rejects.toThrow(BadRequestException);
  });

  it('reverses only the latest provision', async () => {
    await service.createProvision('t1', 'u1', { period: '2026-09' });
    await service.createProvision('t1', 'u1', { period: '2026-10' });
    await expect(service.reverseProvision('t1', 'u1', 'p1')).rejects.toThrow(ConflictException);
    await service.reverseProvision('t1', 'u1', 'p2');
    expect(autoPosting.reverseSource).toHaveBeenCalledWith('t1', 'u1', 'eos_provision', 'p2', undefined);
    expect(provisions[1].status).toBe(EosProvisionStatus.REVERSED);
  });

  it('builds a balanced settlement entry using the provision', () => {
    const s = {
      gratuity: 50000,
      provisionUsed: 45000,
      leaveEncashment: 2000,
      lastSalary: 5000,
      otherAdditions: 1000,
      loanDeduction: 3000,
      otherDeductions: 500,
      net: 54500,
    } as any;
    const lines = EndOfServiceService.settlementLines(s, ACCOUNTS, (k: string) => k);
    expect(sum(lines, 'debit')).toBe(sum(lines, 'credit'));
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: 'eos-prov', debit: 45000 }),
        expect.objectContaining({ accountId: 'eos-exp', debit: 5000 }),
        expect.objectContaining({ accountId: 'salariesExpenseAccountId', debit: 8000 }),
        expect.objectContaining({ accountId: 'employeeAdvancesAccountId', credit: 3000 }),
        expect.objectContaining({ accountId: 'salariesPayableAccountId', credit: 54500 }),
      ]),
    );
    // Provision above the gratuity (e.g. resignation reduction): the excess is released.
    const release = EndOfServiceService.settlementLines({ ...s, provisionUsed: 60000, net: 54500 }, ACCOUNTS, (k: string) => k);
    expect(release).toEqual(expect.arrayContaining([expect.objectContaining({ accountId: 'eos-exp', credit: 10000 })]));
    expect(sum(release, 'debit')).toBe(sum(release, 'credit'));
    // Without EOS accounts the gratuity goes to salaries expense.
    const plain = EndOfServiceService.settlementLines(s, { ...ACCOUNTS, eosExpenseAccountId: null }, (k: string) => k);
    expect(plain[0]).toMatchObject({ accountId: 'salariesExpenseAccountId', debit: 50000 });
  });

  it('computes, posts, pays and cancels a final settlement', async () => {
    await expect(
      service.createSettlement('t1', 'u1', { employeeId: 'e1', reason: 'termination' }),
    ).rejects.toThrow(BadRequestException); // not terminated yet

    saudi.status = EmployeeStatus.TERMINATED;
    saudi.terminationDate = '2026-10-15';
    try {
      await service.createProvision('t1', 'u1', { period: '2026-09' });
      const draft = await service.createSettlement('t1', 'u1', {
        employeeId: 'e1',
        reason: 'resignation',
        deductions: [{ description: 'Uniform', amount: 100 }],
      });
      // 2020-01-01..2026-10-15 = 2480 days -> 6.7945 y; full award 42,945.21; resignation 5-10 y: 2/3
      expect(draft.gratuity).toBe(28630.14);
      expect(draft.leaveDays).toBe(6);
      expect(draft.leaveEncashment).toBe(2000); // 6 x 10,000 / 30
      expect(draft.lastSalary).toBe(4838.71); // 15 / 31 of 10,000
      expect(draft.loanDeduction).toBe(3000);
      expect(draft.net).toBe(Math.round((28630.14 + 2000 + 4838.71 - 100 - 3000) * 100) / 100);

      const posted = await service.postSettlement('t1', 'u1', draft.id);
      expect(posted.status).toBe(FinalSettlementStatus.POSTED);
      expect(posted.provisionUsed).toBe(42534.25);
      const lines = autoPosting.post.mock.calls[1][0].buildLines({}, (k: string) => k);
      expect(sum(lines, 'debit')).toBe(sum(lines, 'credit'));
      expect(loans.applyRecoveries).toHaveBeenCalledWith('t1', [{ id: 'i1', loanId: 'l1', amount: 3000 }], 1);

      // The settled employee's provision is now fully used.
      expect((await service.bookedProvisions('t1', ['e1'])).get('e1')).toBe(0);

      await service.paySettlement('t1', 'u1', draft.id, { date: '2026-10-20', paymentMethod: HrPaymentMethod.BANK });
      expect(autoPosting.post.mock.calls[2][0].buildLines({}, (k: string) => k)).toEqual([
        { accountId: 'salariesPayableAccountId', debit: draft.net },
        { accountId: 'bankAccountId', credit: draft.net },
      ]);

      await service.cancelSettlement('t1', 'u1', draft.id);
      expect(autoPosting.reverseSource).toHaveBeenCalledWith('t1', 'u1', 'final_settlement_payment', draft.id, undefined);
      expect(autoPosting.reverseSource).toHaveBeenCalledWith('t1', 'u1', 'final_settlement', draft.id, undefined);
      expect(loans.applyRecoveries).toHaveBeenLastCalledWith('t1', [{ id: 'i1', loanId: 'l1', amount: 3000 }], -1);
      expect(settlements[0].status).toBe(FinalSettlementStatus.CANCELLED);
    } finally {
      saudi.status = EmployeeStatus.ACTIVE;
      saudi.terminationDate = null;
    }
  });
});
