import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException } from '@nestjs/common';
import { PayrollService, periodBounds } from './payroll.service';
import { PayrollRun, PayrollRunStatus } from '../entities/payroll-run.entity';
import { PayrollLine } from '../entities/payroll-line.entity';
import { AdjustmentKind, PayrollAdjustment } from '../entities/payroll-adjustment.entity';
import { Employee, PayrollCountry } from '../entities/employee.entity';
import { HrPaymentMethod } from '../entities/employee-loan.entity';
import { EmployeesService } from './employees.service';
import { AttendanceService } from './attendance.service';
import { LoansService } from './loans.service';
import { HrSettingsService } from './hr-settings.service';
import { PayrollCalculator } from '../calculators/payroll-calculator';
import { AutoPostingService } from '@modules/accounting/services/auto-posting.service';
import { SequenceService } from '@shared/services/sequence.service';
import { OvertimeService } from './overtime.service';
import { mergeRules } from '../calculators/payroll-rules';

describe('PayrollService', () => {
  let service: PayrollService;
  let run: any;
  let lines: any[];
  let autoPosting: Record<string, jest.Mock>;
  let loans: Record<string, jest.Mock>;
  let adjustmentRepo: Record<string, jest.Mock>;
  let runRepo: Record<string, jest.Mock>;

  const employees = [
    {
      id: 'e-eg',
      code: 'EMP-1',
      nameEn: 'Ahmed',
      hireDate: '2020-01-01',
      terminationDate: null,
      basicSalary: 10000,
      allowances: [{ code: 'transport', name: 'Transport', amount: 2000 }],
      socialInsuranceWage: null,
      socialInsuranceEnrolled: true,
      payrollCountry: PayrollCountry.EG,
      nationality: 'EG',
      branchId: 'b1',
      departmentId: null,
      trackAttendance: false,
    },
    {
      id: 'e-sa',
      code: 'EMP-2',
      nameEn: 'Ravi',
      hireDate: '2021-05-01',
      terminationDate: null,
      basicSalary: 9000,
      allowances: [{ code: 'housing', name: 'Housing', amount: 1000 }],
      socialInsuranceWage: null,
      socialInsuranceEnrolled: true,
      payrollCountry: PayrollCountry.SA,
      nationality: 'IN',
      branchId: 'b2',
      departmentId: null,
      trackAttendance: false,
    },
  ] as unknown as Employee[];

  beforeEach(async () => {
    run = null;
    lines = [];
    const qb: any = {};
    for (const m of ['where', 'andWhere', 'orderBy']) qb[m] = jest.fn(() => qb);
    qb.getMany = jest.fn(async () => employees);

    runRepo = {
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => (run = { id: 'run-1', ...x })),
      findOne: jest.fn(async () => (run ? { ...run } : null)),
      find: jest.fn(async () => (run ? [run] : [])),
      update: jest.fn(async (_id, patch) => Object.assign(run, patch)),
    };
    const lineRepo = {
      create: jest.fn((x) => x),
      delete: jest.fn(async () => (lines = [])),
      save: jest.fn(async (xs) => {
        lines = xs.map((x: any, i: number) => ({ id: `line-${i}`, ...x }));
        return lines;
      }),
      find: jest.fn(async () => lines),
      findOne: jest.fn(async ({ where }) => lines.find((l) => l.employeeId === where.employeeId) ?? null),
    };
    adjustmentRepo = {
      find: jest.fn(async ({ where }) =>
        where.employeeId === 'e-eg'
          ? [{ id: 'adj-1', kind: AdjustmentKind.ADDITION, description: 'Bonus', amount: 1000, taxable: true }]
          : [{ id: 'adj-2', kind: AdjustmentKind.DEDUCTION, description: 'Penalty', amount: 200, taxable: true }],
      ),
      update: jest.fn(),
    };
    autoPosting = { post: jest.fn().mockResolvedValue(null), preflight: jest.fn(), reverseSource: jest.fn() };
    loans = {
      dueInstallments: jest.fn(async (_t, employeeId) =>
        employeeId === 'e-sa' ? [{ id: 'inst-1', loanId: 'loan-1', amount: 500 }] : [],
      ),
      applyRecoveries: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        PayrollService,
        { provide: getRepositoryToken(PayrollRun), useValue: runRepo },
        { provide: getRepositoryToken(PayrollLine), useValue: lineRepo },
        { provide: getRepositoryToken(PayrollAdjustment), useValue: adjustmentRepo },
        { provide: getRepositoryToken(Employee), useValue: { createQueryBuilder: () => qb, find: jest.fn() } },
        { provide: EmployeesService, useValue: { findById: jest.fn(async (_t, id) => employees.find((e) => e.id === id)) } },
        {
          provide: AttendanceService,
          useValue: {
            summarize: jest.fn(async () => ({
              workingDays: 22,
              presentDays: 0,
              absenceDays: 0,
              paidLeaveDays: 0,
              unpaidLeaveDays: 0,
              lateMinutes: 0,
              overtimeHours: 0,
              workedHours: 0,
              days: [],
              schedule: { dailyHours: 8, startTime: '09:00', weekendDays: [5, 6], graceMinutes: 0 },
            })),
          },
        },
        { provide: LoansService, useValue: loans },
        {
          provide: HrSettingsService,
          useValue: {
            getCalculator: async () => new PayrollCalculator(),
            getRules: async () => mergeRules({}),
            getAccounts: async () => ({ martyrsFundAccountId: null }),
          },
        },
        { provide: OvertimeService, useValue: { approvedBetween: jest.fn(async () => []) } },
        { provide: AutoPostingService, useValue: autoPosting },
        { provide: SequenceService, useValue: { next: jest.fn().mockResolvedValue('PAY-000001') } },
      ],
    }).compile();
    service = module.get(PayrollService);
  });

  it('derives the period bounds', () => {
    expect(periodBounds('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28', days: 28 });
    expect(periodBounds('2028-02').days).toBe(29);
  });

  it('computes a draft run with Egyptian and Saudi employees', async () => {
    const result = await service.create('t1', 'u1', { period: '2026-10' });
    expect(result.status).toBe(PayrollRunStatus.DRAFT);
    expect(result.employeeCount).toBe(2);

    const eg = lines.find((l) => l.employeeId === 'e-eg');
    expect(eg.gross).toBe(13000); // 12,000 fixed + 1,000 bonus
    expect(eg.employeeSi).toBe(1320);
    expect(eg.employerSi).toBe(2250);
    expect(eg.incomeTax).toBeGreaterThan(0);

    const sa = lines.find((l) => l.employeeId === 'e-sa');
    expect(sa.gross).toBe(10000);
    expect(sa.employeeSi).toBe(0); // non-Saudi
    expect(sa.employerSi).toBe(200); // 2% of basic + housing
    expect(sa.incomeTax).toBe(0);
    expect(sa.loanDeduction).toBe(500);
    expect(sa.otherDeductions).toBe(200);
    expect(sa.net).toBe(9300);
    expect(sa.details.adjustmentIds).toEqual(['adj-2']);
  });

  it('posts a balanced accrual entry on approval and recovers loans', async () => {
    await service.create('t1', 'u1', { period: '2026-10' });
    await service.approve('t1', 'u1', 'run-1', {});

    expect(autoPosting.preflight).toHaveBeenCalledWith('t1', '2026-10-31', expect.arrayContaining(['salariesExpenseAccountId']));
    const request = autoPosting.post.mock.calls[0][0];
    expect(request.sourceType).toBe('payroll_run');
    const posted = request.buildLines({}, (key: string) => key);
    const total = (key: string, side: 'debit' | 'credit') =>
      Math.round(posted.filter((l: any) => l.accountId === key).reduce((s: number, l: any) => s + (l[side] ?? 0), 0) * 100) / 100;
    const debit = posted.reduce((s: number, l: any) => s + (l.debit ?? 0), 0);
    const credit = posted.reduce((s: number, l: any) => s + (l.credit ?? 0), 0);
    expect(Math.round(debit * 100)).toBe(Math.round(credit * 100));

    expect(total('salariesExpenseAccountId', 'debit')).toBe(Number(run.totalGross));
    expect(total('socialInsuranceExpenseAccountId', 'debit')).toBe(2450);
    expect(total('socialInsurancePayableAccountId', 'credit')).toBe(1320 + 2250 + 200);
    expect(total('employeeAdvancesAccountId', 'credit')).toBe(500);
    expect(total('salariesExpenseAccountId', 'credit')).toBe(200);
    expect(total('payrollTaxPayableAccountId', 'credit')).toBe(Number(run.totalTax));
    expect(total('salariesPayableAccountId', 'credit')).toBe(Number(run.totalNet));
    expect(posted.find((l: any) => l.accountId === 'salariesExpenseAccountId').branchId).toBe('b1');

    expect(loans.applyRecoveries).toHaveBeenCalledWith('t1', [{ id: 'inst-1', loanId: 'loan-1', amount: 500 }], 1);
    expect(adjustmentRepo.update).toHaveBeenCalledWith(expect.anything(), { payrollRunId: 'run-1' });
    expect(run.status).toBe(PayrollRunStatus.APPROVED);
  });

  it('pays an approved run from the bank', async () => {
    await service.create('t1', 'u1', { period: '2026-10' });
    await service.approve('t1', 'u1', 'run-1', {});
    await service.pay('t1', 'u1', 'run-1', { date: '2026-11-01', paymentMethod: HrPaymentMethod.BANK });

    const request = autoPosting.post.mock.calls[1][0];
    expect(request.sourceType).toBe('payroll_payment');
    expect(request.buildLines({}, (k: string) => k)).toEqual([
      { accountId: 'salariesPayableAccountId', debit: Number(run.totalNet) },
      { accountId: 'bankAccountId', credit: Number(run.totalNet) },
    ]);
    expect(run.status).toBe(PayrollRunStatus.PAID);
  });

  it('reverses a paid run: both entries, loan recoveries and adjustments', async () => {
    await service.create('t1', 'u1', { period: '2026-10' });
    await service.approve('t1', 'u1', 'run-1', {});
    await service.pay('t1', 'u1', 'run-1', { date: '2026-11-01', paymentMethod: HrPaymentMethod.CASH });
    await service.reverse('t1', 'u1', 'run-1', {});

    expect(autoPosting.reverseSource).toHaveBeenCalledWith('t1', 'u1', 'payroll_payment', 'run-1', undefined);
    expect(autoPosting.reverseSource).toHaveBeenCalledWith('t1', 'u1', 'payroll_run', 'run-1', undefined);
    expect(loans.applyRecoveries).toHaveBeenLastCalledWith('t1', [{ id: 'inst-1', loanId: 'loan-1', amount: 500 }], -1);
    expect(adjustmentRepo.update).toHaveBeenLastCalledWith({ tenantId: 't1', payrollRunId: 'run-1' }, { payrollRunId: null });
    expect(run.status).toBe(PayrollRunStatus.REVERSED);
  });

  it('enforces the run lifecycle', async () => {
    await service.create('t1', 'u1', { period: '2026-10' });
    await expect(
      service.pay('t1', 'u1', 'run-1', { date: '2026-11-01', paymentMethod: HrPaymentMethod.BANK }),
    ).rejects.toThrow(ConflictException);
    await expect(service.reverse('t1', 'u1', 'run-1')).rejects.toThrow(ConflictException);

    await service.approve('t1', 'u1', 'run-1', {});
    await expect(service.recompute('t1', 'run-1')).rejects.toThrow(ConflictException);
    await expect(service.cancel('t1', 'run-1')).rejects.toThrow(ConflictException);
    await expect(service.approve('t1', 'u1', 'run-1', {})).rejects.toThrow(ConflictException);
  });

  it('refuses to create a run with no eligible employee', async () => {
    const original = [...employees];
    employees.length = 0;
    try {
      await expect(service.create('t1', 'u1', { period: '2026-10' })).rejects.toThrow(
        'No employee to pay',
      );
    } finally {
      employees.push(...original);
    }
  });

  it('cancels a draft run without posting', async () => {
    await service.create('t1', 'u1', { period: '2026-10' });
    await service.cancel('t1', 'run-1');
    expect(run.status).toBe(PayrollRunStatus.CANCELLED);
    expect(autoPosting.post).not.toHaveBeenCalled();
  });

  it('puts the employee cost center on the payslip and the expense lines', async () => {
    (employees[0] as any).costCenterId = 'cc-sales';
    try {
      await service.create('t1', 'u1', { period: '2026-10' });
      const eg = lines.find((l) => l.employeeId === 'e-eg');
      expect(eg.costCenterId).toBe('cc-sales');
      await service.approve('t1', 'u1', 'run-1', {});
      const posted = autoPosting.post.mock.calls[0][0].buildLines({}, (k: string) => k);
      const expense = posted.find((l: any) => l.accountId === 'salariesExpenseAccountId' && l.branchId === 'b1');
      expect(expense.costCenterId).toBe('cc-sales');
    } finally {
      delete (employees[0] as any).costCenterId;
    }
  });

  it('posts the Martyrs fund and debits a negative (refund) tax', () => {
    const line = {
      gross: 10000,
      employeeSi: 1100,
      employerSi: 1875,
      incomeTax: -300,
      martyrsFund: 5,
      martyrsFundEmployer: 0,
      loanDeduction: 0,
      otherDeductions: 0,
      net: 10000 - 1100 + 300 - 5,
      branchId: 'b1',
      costCenterId: 'cc1',
    } as any;
    const posted = PayrollService.accrualLines([line], (k: string) => k, 'fund-acc');
    const debit = posted.reduce((s, l) => s + (l.debit ?? 0), 0);
    const credit = posted.reduce((s, l) => s + (l.credit ?? 0), 0);
    expect(Math.round(debit * 100)).toBe(Math.round(credit * 100));
    expect(posted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: 'payrollTaxPayableAccountId', debit: 300 }),
        expect.objectContaining({ accountId: 'fund-acc', credit: 5 }),
      ]),
    );
    // Employer-borne fund is an extra salaries expense.
    const employer = PayrollService.accrualLines(
      [{ ...line, incomeTax: 0, martyrsFund: 0, martyrsFundEmployer: 5, net: 8900 }],
      (k: string) => k,
    );
    expect(employer[0]).toMatchObject({ accountId: 'salariesExpenseAccountId', debit: 10005 });
    expect(employer).toEqual(
      expect.arrayContaining([expect.objectContaining({ accountId: 'payrollTaxPayableAccountId', credit: 5 })]),
    );
  });

  it('feeds the year-to-date of earlier approved months into the Egyptian tax', async () => {
    const earlier = { id: 'run-0', period: '2026-09', status: PayrollRunStatus.APPROVED };
    runRepo.find.mockImplementation(async ({ where }: any) =>
      [earlier, ...(run ? [run] : [])].filter(
        (r) => typeof where.period !== 'string' || r.period === where.period,
      ),
    );
    const lineRepo: any = (service as any).lineRepo;
    const originalFind = lineRepo.find;
    lineRepo.find = jest.fn(async ({ where }: any) =>
      where.runId && where.runId._value?.includes('run-0')
        ? [
            {
              runId: 'run-0',
              employeeId: 'e-eg',
              payrollCountry: PayrollCountry.EG,
              incomeTax: 900,
              details: { incomeTax: { regularTaxable: 10680, irregularTaxable: 0 } },
            },
          ]
        : originalFind(),
    );
    await service.create('t1', 'u1', { period: '2026-10' });
    const eg = lines.find((l) => l.employeeId === 'e-eg');
    expect(eg.details.incomeTax.method).toBe('cumulative');
    expect(eg.details.incomeTax.cumulative).toMatchObject({ months: 2, taxBefore: 900 });
  });

  it('refuses to delete an adjustment consumed by an approved run', async () => {
    const repo = adjustmentRepo as any;
    repo.findOne = jest.fn().mockResolvedValue({ id: 'adj-1', payrollRunId: 'run-1' });
    await expect(service.deleteAdjustment('t1', 'adj-1')).rejects.toThrow(ConflictException);
  });
});
