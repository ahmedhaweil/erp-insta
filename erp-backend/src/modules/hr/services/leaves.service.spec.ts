import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { LeavesService } from './leaves.service';
import { LeaveType } from '../entities/leave-type.entity';
import { LeaveRequest, LeaveRequestStatus } from '../entities/leave-request.entity';
import { EmployeeStatus } from '../entities/employee.entity';
import { EmployeesService } from './employees.service';
import { HrOrganizationService, FALLBACK_SCHEDULE } from './hr-organization.service';
import { SequenceService } from '@shared/services/sequence.service';
import { LeaveEncashment } from '../entities/leave-encashment.entity';
import { PayrollAdjustment } from '../entities/payroll-adjustment.entity';
import { HrSettingsService } from './hr-settings.service';
import { PayrollLockService } from './payroll-lock.service';
import { mergeRules } from '../calculators/payroll-rules';

describe('LeavesService', () => {
  let service: LeavesService;
  let requests: any[];
  let saved: any;
  let encashments: any[];
  let payrollLock: Record<string, jest.Mock>;

  const annual = {
    id: 'lt-annual',
    code: 'annual',
    name: 'Annual',
    isPaid: true,
    annualEntitlement: 21,
    seniorEntitlement: 30,
    seniorAfterYears: 10,
    allowNegative: false,
    isActive: true,
  } as unknown as LeaveType;
  const employee = { id: 'e1', hireDate: '2020-01-01', status: EmployeeStatus.ACTIVE, workScheduleId: null };

  beforeEach(async () => {
    requests = [];
    saved = null;
    encashments = [];
    payrollLock = { assertOpen: jest.fn(), lockedPeriods: jest.fn(async () => []) };
    const requestRepo = {
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => (saved = { id: 'lr-new', ...x })),
      find: jest.fn(async () => requests),
      findOne: jest.fn(async ({ where }) => (where.id ? requests.find((r) => r.id === where.id) : null) ?? null),
    };
    const module = await Test.createTestingModule({
      providers: [
        LeavesService,
        {
          provide: getRepositoryToken(LeaveType),
          useValue: { findOne: jest.fn(async () => annual), find: jest.fn(async () => [annual]) },
        },
        { provide: getRepositoryToken(LeaveRequest), useValue: requestRepo },
        {
          provide: EmployeesService,
          useValue: { findById: jest.fn(async () => employee), monthlyWage: jest.fn(() => 9000) },
        },
        {
          provide: HrOrganizationService,
          useValue: {
            resolveSchedule: jest.fn(async () => FALLBACK_SCHEDULE),
            holidaySet: jest.fn(async () => new Set(['2026-10-06'])),
          },
        },
        { provide: SequenceService, useValue: { next: jest.fn().mockResolvedValue('LV-000001') } },
        {
          provide: getRepositoryToken(LeaveEncashment),
          useValue: { find: jest.fn(async () => encashments), create: jest.fn((x) => x), save: jest.fn(async (x) => x) },
        },
        {
          provide: getRepositoryToken(PayrollAdjustment),
          useValue: { create: jest.fn((x) => x), save: jest.fn(async (x) => ({ id: 'adj-1', ...x })) },
        },
        { provide: HrSettingsService, useValue: { getRules: jest.fn(async () => mergeRules({})) } },
        { provide: PayrollLockService, useValue: payrollLock },
      ],
    }).compile();
    service = module.get(LeavesService);
  });

  it('counts working days only (weekend and holidays excluded)', async () => {
    // 2026-10-01 Thu .. 2026-10-08 Thu: Fri/Sat weekend and the 6th is a holiday.
    await service.create('t1', 'u1', {
      employeeId: 'e1',
      leaveTypeId: 'lt-annual',
      startDate: '2026-10-01',
      endDate: '2026-10-08',
    });
    expect(saved.days).toBe(5);
    expect(saved.status).toBe(LeaveRequestStatus.DRAFT);
  });

  it('prorates the entitlement for joiners and applies the senior entitlement', () => {
    expect(service.entitlementFor(annual, { hireDate: '2020-01-01' }, 2026)).toBe(21);
    expect(service.entitlementFor(annual, { hireDate: '2015-06-01' }, 2026)).toBe(30);
    expect(service.entitlementFor(annual, { hireDate: '2026-07-02' }, 2026)).toBe(10.53) // 21 * 183 / 365;
    expect(service.entitlementFor(annual, { hireDate: '2027-01-01' }, 2026)).toBe(0);
  });

  it('computes the balance from approved and pending requests', async () => {
    requests = [
      { id: 'a', status: LeaveRequestStatus.APPROVED, startDate: '2026-03-01', endDate: '2026-03-10', days: 8 },
      { id: 'b', status: LeaveRequestStatus.DRAFT, startDate: '2026-11-01', endDate: '2026-11-02', days: 2 },
    ];
    const balance = await service.balanceFor('t1', employee as any, annual, 2026);
    expect(balance).toMatchObject({ entitlement: 21, taken: 8, pending: 2, remaining: 13 });
  });

  it('refuses to approve beyond the remaining balance', async () => {
    requests = [
      { id: 'old', status: LeaveRequestStatus.APPROVED, startDate: '2026-01-04', endDate: '2026-01-31', days: 20 },
      {
        id: 'new',
        status: LeaveRequestStatus.DRAFT,
        leaveTypeId: 'lt-annual',
        employeeId: 'e1',
        startDate: '2026-02-01',
        endDate: '2026-02-03',
        days: 3,
      },
    ];
    await expect(service.approve('t1', 'u1', 'new')).rejects.toThrow(BadRequestException);
  });

  it('creates a half-day request of 0.5 day', async () => {
    await service.create('t1', 'u1', {
      employeeId: 'e1',
      leaveTypeId: 'lt-annual',
      startDate: '2026-10-04',
      endDate: '2026-10-04',
      halfDay: true,
      halfDayPeriod: 'pm',
    });
    expect(saved).toMatchObject({ days: 0.5, halfDay: true, halfDayPeriod: 'pm' });
    await expect(
      service.create('t1', 'u1', {
        employeeId: 'e1',
        leaveTypeId: 'lt-annual',
        startDate: '2026-10-04',
        endDate: '2026-10-05',
        halfDay: true,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('marks half days in the leave-day map used by attendance', async () => {
    requests = [{ id: 'h', leaveTypeId: 'lt-annual', status: LeaveRequestStatus.APPROVED, startDate: '2026-10-04', endDate: '2026-10-04', days: 0.5, halfDay: true }];
    const map = await service.leaveDays('t1', 'e1', '2026-10-01', '2026-10-31');
    expect(map.get('2026-10-04')).toEqual({ paid: true, fraction: 0.5 });
  });

  it('blocks approving or cancelling leave in a month with an approved payroll', async () => {
    payrollLock.assertOpen.mockRejectedValue(new ConflictException('locked'));
    requests = [
      { id: 'd', status: LeaveRequestStatus.DRAFT, leaveTypeId: 'lt-annual', employeeId: 'e1', startDate: '2026-09-01', endDate: '2026-09-02', days: 2 },
      { id: 'a', status: LeaveRequestStatus.APPROVED, leaveTypeId: 'lt-annual', employeeId: 'e1', startDate: '2026-09-06', endDate: '2026-09-06', days: 1 },
    ];
    await expect(service.approve('t1', 'u1', 'd')).rejects.toThrow(ConflictException);
    await expect(service.cancel('t1', 'u1', 'a')).rejects.toThrow(ConflictException);
    expect(payrollLock.assertOpen).toHaveBeenCalledWith('t1', 'e1', '2026-09-06', '2026-09-06', expect.any(String));
    // A draft can still be withdrawn.
    payrollLock.assertOpen.mockClear();
    await service.cancel('t1', 'u1', 'd');
    expect(payrollLock.assertOpen).not.toHaveBeenCalled();
  });

  it('includes carry-forward and encashments in the balance', async () => {
    const carrying = { ...annual, carryForward: true, carryForwardMax: 5 } as unknown as LeaveType;
    requests = [
      { id: 'a', status: LeaveRequestStatus.APPROVED, startDate: '2025-03-01', endDate: '2025-03-05', days: 3 },
      { id: 'b', status: LeaveRequestStatus.APPROVED, startDate: '2026-03-01', endDate: '2026-03-03', days: 2 },
    ];
    encashments = [{ year: 2026, days: 4 }];
    const balance = await service.balanceFor('t1', employee as any, carrying, 2026, '2026-06-30');
    // 2025: 21 - 3 = 18 -> capped at 5 ; 2026: 5 + 21 - 2 - 4 encashed
    expect(balance).toMatchObject({ carriedIn: 5, taken: 2, encashed: 4, remaining: 20 });
  });

  it('encashes leave as a taxable payroll addition within the balance', async () => {
    const encashable = { ...annual, encashable: true } as unknown as LeaveType;
    (service as any).typeRepo.findOne = jest.fn(async () => encashable);
    const result = await service.createEncashment('t1', 'u1', {
      employeeId: 'e1',
      leaveTypeId: 'lt-annual',
      year: 2026,
      days: 3,
      period: '2026-12',
    });
    expect(result).toMatchObject({ days: 3, dailyRate: 300, amount: 900, payrollAdjustmentId: 'adj-1' });
    await expect(
      service.createEncashment('t1', 'u1', { employeeId: 'e1', leaveTypeId: 'lt-annual', year: 2026, days: 30, period: '2026-12' }),
    ).rejects.toThrow(BadRequestException);
    (service as any).typeRepo.findOne = jest.fn(async () => annual);
    await expect(
      service.createEncashment('t1', 'u1', { employeeId: 'e1', leaveTypeId: 'lt-annual', year: 2026, days: 1, period: '2026-12' }),
    ).rejects.toThrow('not encashable');
  });

  it('only approves drafts', async () => {
    requests = [{ id: 'x', status: LeaveRequestStatus.REJECTED }];
    await expect(service.approve('t1', 'u1', 'x')).rejects.toThrow(ConflictException);
  });
});
