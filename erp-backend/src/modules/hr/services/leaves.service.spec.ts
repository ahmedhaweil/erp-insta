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

describe('LeavesService', () => {
  let service: LeavesService;
  let requests: any[];
  let saved: any;

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
        { provide: EmployeesService, useValue: { findById: jest.fn(async () => employee) } },
        {
          provide: HrOrganizationService,
          useValue: {
            resolveSchedule: jest.fn(async () => FALLBACK_SCHEDULE),
            holidaySet: jest.fn(async () => new Set(['2026-10-06'])),
          },
        },
        { provide: SequenceService, useValue: { next: jest.fn().mockResolvedValue('LV-000001') } },
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

  it('only approves drafts', async () => {
    requests = [{ id: 'x', status: LeaveRequestStatus.REJECTED }];
    await expect(service.approve('t1', 'u1', 'x')).rejects.toThrow(ConflictException);
  });
});
