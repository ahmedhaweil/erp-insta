import { BadRequestException, ConflictException } from '@nestjs/common';
import { InstallmentPlansService } from './installment-plans.service';
import { InstallmentScheduleService } from './installment-schedule.service';
import {
  Installment,
  InstallmentFrequency,
  InstallmentPlanStatus,
  InstallmentStatus,
} from '../entities/installment-plan.entity';
import { SalesInvoiceStatus, SalesInvoiceType } from '../entities/sales-invoice.entity';

describe('InstallmentScheduleService', () => {
  it('builds a down payment and equal monthly installments with the remainder last', () => {
    const schedule = InstallmentScheduleService.buildSchedule({
      startDate: '2026-01-31',
      firstDueDate: '2026-02-28',
      frequency: InstallmentFrequency.MONTHLY,
      numberOfInstallments: 3,
      downPayment: 100,
      installmentsTotal: 1000,
    });
    expect(schedule).toEqual([
      { sequence: 0, dueDate: '2026-01-31', amount: 100 },
      { sequence: 1, dueDate: '2026-02-28', amount: 333.33 },
      { sequence: 2, dueDate: '2026-03-28', amount: 333.33 },
      { sequence: 3, dueDate: '2026-04-28', amount: 333.34 },
    ]);
  });

  it('builds weekly schedules', () => {
    const schedule = InstallmentScheduleService.buildSchedule({
      startDate: '2026-01-01',
      firstDueDate: '2026-01-08',
      frequency: InstallmentFrequency.WEEKLY,
      numberOfInstallments: 2,
      downPayment: 0,
      installmentsTotal: 100,
    });
    expect(schedule.map((s) => s.dueDate)).toEqual(['2026-01-08', '2026-01-15']);
  });

  it('allocates payments by due date and flags overdue installments', () => {
    const inst = (sequence: number, dueDate: string, amount: number) =>
      ({ sequence, dueDate, amount, paidAmount: 0, status: InstallmentStatus.DUE }) as Installment;
    const result = InstallmentScheduleService.allocate(
      [inst(2, '2026-03-01', 100), inst(1, '2026-02-01', 100), inst(3, '2026-04-01', 100)],
      150,
      '2026-03-15',
    );
    expect(result.map((i) => [i.sequence, i.paidAmount, i.status])).toEqual([
      [1, 100, InstallmentStatus.PAID],
      [2, 50, InstallmentStatus.OVERDUE],
      [3, 0, InstallmentStatus.DUE],
    ]);
    const partial = InstallmentScheduleService.allocate([inst(1, '2026-05-01', 100)], 40, '2026-03-15');
    expect(partial[0].status).toBe(InstallmentStatus.PARTIAL);
  });
});

describe('InstallmentPlansService', () => {
  let service: InstallmentPlansService;
  let planRepo: Record<string, jest.Mock>;
  let invoiceRepo: Record<string, jest.Mock>;
  let invoicesService: Record<string, jest.Mock>;
  let schedule: Record<string, jest.Mock>;
  let autoPosting: Record<string, jest.Mock>;

  const invoice = () => ({
    id: 'inv-1',
    tenantId: 't1',
    invoiceNumber: 'INV-1',
    customerId: 'c1',
    moveType: SalesInvoiceType.INVOICE,
    status: SalesInvoiceStatus.PARTIAL,
    totalAmount: 1140,
    paidAmount: 140,
    installmentInterest: 0,
    exchangeRate: 1,
    lines: [],
  });

  beforeEach(() => {
    planRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((x) => x),
      save: jest.fn((x) => ({ id: 'plan-1', ...x })),
    };
    invoiceRepo = { save: jest.fn((x) => x) };
    invoicesService = {
      findById: jest.fn().mockResolvedValue(invoice()),
      adjustCustomerBalance: jest.fn(),
    };
    schedule = { applyToPlan: jest.fn() };
    autoPosting = { preflight: jest.fn(), post: jest.fn(), reverseSource: jest.fn() };
    service = new InstallmentPlansService(
      planRepo as any,
      { create: jest.fn((x) => x) } as any,
      invoiceRepo as any,
      invoicesService as any,
      schedule as any,
      autoPosting as any,
      { next: jest.fn().mockResolvedValue('INST-000001') } as any,
    );
    jest.spyOn(service, 'findById').mockImplementation(async () => ({ id: 'plan-1' }) as any);
  });

  it('recognises flat financing income and adds it to the invoice', async () => {
    await service.create('t1', 'u1', {
      invoiceId: 'inv-1',
      startDate: '2026-01-01',
      downPayment: 200,
      numberOfInstallments: 4,
      interestRate: 10,
    });

    // residual 1000, financed 800, interest 80
    const saved = planRepo.save.mock.calls[0][0];
    expect(saved).toEqual(
      expect.objectContaining({
        principalAmount: 1000,
        interestAmount: 80,
        totalAmount: 1080,
        paidBeforePlan: 140,
        firstDueDate: '2026-02-01',
      }),
    );
    expect(saved.installments).toHaveLength(5);
    expect(saved.installments[1].amount).toBe(220);

    const lines = autoPosting.post.mock.calls[0][0].buildLines({}, (k: string) => k);
    expect(lines).toEqual([
      { accountId: 'receivableAccountId', debit: 80 },
      { accountId: 'installmentInterestAccountId', credit: 80 },
    ]);
    expect(invoiceRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ totalAmount: 1220, installmentInterest: 80 }),
    );
    expect(invoicesService.adjustCustomerBalance).toHaveBeenCalledWith('t1', 'c1', 80);
    expect(schedule.applyToPlan).toHaveBeenCalledWith(expect.anything(), 140);
  });

  it('does not post anything without interest', async () => {
    await service.create('t1', 'u1', { invoiceId: 'inv-1', numberOfInstallments: 2 });
    expect(autoPosting.post).not.toHaveBeenCalled();
    expect(invoiceRepo.save).not.toHaveBeenCalled();
  });

  it('rejects a down payment covering the whole residual', async () => {
    await expect(
      service.create('t1', 'u1', { invoiceId: 'inv-1', numberOfInstallments: 2, downPayment: 1000 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a second plan on the same invoice and unposted invoices', async () => {
    planRepo.findOne.mockResolvedValueOnce({ planNumber: 'INST-1' });
    await expect(
      service.create('t1', 'u1', { invoiceId: 'inv-1', numberOfInstallments: 2 }),
    ).rejects.toThrow(ConflictException);

    invoicesService.findById.mockResolvedValue({ ...invoice(), status: SalesInvoiceStatus.DRAFT });
    await expect(
      service.create('t1', 'u1', { invoiceId: 'inv-1', numberOfInstallments: 2 }),
    ).rejects.toThrow(ConflictException);
  });

  it('refuses to cancel plans with collected installments', async () => {
    (service.findById as jest.Mock).mockResolvedValue({
      id: 'plan-1',
      status: InstallmentPlanStatus.ACTIVE,
      paidAmount: 10,
    });
    await expect(service.cancel('t1', 'u1', 'plan-1')).rejects.toThrow(ConflictException);
  });
});
