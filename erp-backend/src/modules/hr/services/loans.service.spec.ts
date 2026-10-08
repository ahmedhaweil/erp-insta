import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException } from '@nestjs/common';
import { LoansService, addMonths, splitInstallments } from './loans.service';
import { EmployeeLoan, HrPaymentMethod, LoanStatus } from '../entities/employee-loan.entity';
import { LoanInstallment } from '../entities/loan-installment.entity';
import { EmployeesService } from './employees.service';
import { AutoPostingService } from '@modules/accounting/services/auto-posting.service';
import { SequenceService } from '@shared/services/sequence.service';

describe('LoansService', () => {
  let service: LoansService;
  let loan: any;
  let installments: any[];
  let autoPosting: Record<string, jest.Mock>;

  beforeEach(async () => {
    loan = {
      id: 'loan-1',
      tenantId: 't1',
      loanNumber: 'LOAN-000001',
      employeeId: 'e1',
      type: 'loan',
      amount: 1000,
      installmentCount: 3,
      startPeriod: '2026-11',
      repaidAmount: 0,
      status: LoanStatus.DRAFT,
    };
    installments = [];
    const loanRepo = {
      findOne: jest.fn(async () => ({ ...loan, installments })),
      find: jest.fn(async () => [loan]),
      update: jest.fn(async (_id, patch) => Object.assign(loan, patch)),
    };
    const installmentRepo = {
      create: jest.fn((x) => x),
      save: jest.fn(async (xs) => {
        installments = xs.map((x: any, i: number) => ({ id: `i${i + 1}`, ...x }));
        return installments;
      }),
      find: jest.fn(async () => installments),
      update: jest.fn(async (id, patch) => Object.assign(installments.find((i) => i.id === id), patch)),
      delete: jest.fn(async () => (installments = [])),
    };
    autoPosting = { post: jest.fn(), preflight: jest.fn(), reverseSource: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        LoansService,
        { provide: getRepositoryToken(EmployeeLoan), useValue: loanRepo },
        { provide: getRepositoryToken(LoanInstallment), useValue: installmentRepo },
        { provide: EmployeesService, useValue: { findById: jest.fn() } },
        { provide: AutoPostingService, useValue: autoPosting },
        { provide: SequenceService, useValue: { next: jest.fn() } },
      ],
    }).compile();
    service = module.get(LoansService);
  });

  it('splits installments and rolls periods over the year end', () => {
    expect(splitInstallments(1000, 3)).toEqual([333.33, 333.33, 333.34]);
    expect(addMonths('2026-11', 2)).toBe('2027-01');
    expect(addMonths('2026-01', 0)).toBe('2026-01');
  });

  it('disburses: posts Dr employee advances / Cr cash and schedules installments', async () => {
    await service.disburse('t1', 'u1', 'loan-1', { date: '2026-10-15', paymentMethod: HrPaymentMethod.CASH });

    expect(autoPosting.preflight).toHaveBeenCalledWith('t1', '2026-10-15', ['employeeAdvancesAccountId', 'cashAccountId']);
    const request = autoPosting.post.mock.calls[0][0];
    expect(request.sourceType).toBe('employee_loan');
    expect(request.buildLines({}, (k: string) => k)).toEqual([
      { accountId: 'employeeAdvancesAccountId', debit: 1000 },
      { accountId: 'cashAccountId', credit: 1000 },
    ]);
    expect(installments.map((i) => [i.duePeriod, i.amount])).toEqual([
      ['2026-11', 333.33],
      ['2026-12', 333.33],
      ['2027-01', 333.34],
    ]);
    expect(loan.status).toBe(LoanStatus.DISBURSED);
  });

  it('returns only outstanding installments due up to the period', async () => {
    await service.disburse('t1', 'u1', 'loan-1', { date: '2026-10-15', paymentMethod: HrPaymentMethod.BANK });
    installments[0].paidAmount = 333.33;
    expect(await service.dueInstallments('t1', 'e1', '2026-12')).toEqual([
      { id: 'i2', loanId: 'loan-1', amount: 333.33 },
    ]);
  });

  it('settles the loan when every installment is recovered, and reopens it on reversal', async () => {
    await service.disburse('t1', 'u1', 'loan-1', { date: '2026-10-15', paymentMethod: HrPaymentMethod.BANK });
    const all = installments.map((i) => ({ id: i.id, loanId: 'loan-1', amount: i.amount }));
    await service.applyRecoveries('t1', all, 1);
    expect(loan.repaidAmount).toBe(1000);
    expect(loan.status).toBe(LoanStatus.SETTLED);

    await service.applyRecoveries('t1', all.slice(2), -1);
    expect(loan.status).toBe(LoanStatus.DISBURSED);
    expect(loan.repaidAmount).toBe(666.66);
  });

  it('refuses to over-recover an installment', async () => {
    await service.disburse('t1', 'u1', 'loan-1', { date: '2026-10-15', paymentMethod: HrPaymentMethod.BANK });
    await expect(
      service.applyRecoveries('t1', [{ id: 'i1', loanId: 'loan-1', amount: 500 }], 1),
    ).rejects.toThrow(ConflictException);
  });

  it('cancels a disbursed loan only before any recovery', async () => {
    await service.disburse('t1', 'u1', 'loan-1', { date: '2026-10-15', paymentMethod: HrPaymentMethod.BANK });
    loan.repaidAmount = 100;
    await expect(service.cancel('t1', 'u1', 'loan-1')).rejects.toThrow(ConflictException);

    loan.repaidAmount = 0;
    await service.cancel('t1', 'u1', 'loan-1');
    expect(autoPosting.reverseSource).toHaveBeenCalledWith('t1', 'u1', 'employee_loan', 'loan-1');
    expect(loan.status).toBe(LoanStatus.CANCELLED);
  });
});
