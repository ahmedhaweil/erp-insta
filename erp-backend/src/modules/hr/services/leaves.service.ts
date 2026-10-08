import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { LeaveType } from '../entities/leave-type.entity';
import { LeaveRequest, LeaveRequestStatus } from '../entities/leave-request.entity';
import { Employee, EmployeeStatus } from '../entities/employee.entity';
import { LeaveEncashment, LeaveEncashmentStatus } from '../entities/leave-encashment.entity';
import { AdjustmentKind, PayrollAdjustment } from '../entities/payroll-adjustment.entity';
import {
  CreateLeaveEncashmentDto,
  CreateLeaveRequestDto,
  CreateLeaveTypeDto,
  DecideLeaveDto,
  LeaveEncashmentQueryDto,
  LeaveRequestQueryDto,
  UpdateLeaveTypeDto,
} from '../dto/leave.dto';
import { HrOrganizationService } from './hr-organization.service';
import { EmployeesService } from './employees.service';
import { HrSettingsService } from './hr-settings.service';
import { PayrollLockService } from './payroll-lock.service';
import { SequenceService } from '@shared/services/sequence.service';
import { round, today } from '@shared/utils/document-totals.util';
import { LeaveDayValue, eachDate, weekday } from '../calculators/attendance-calculator';
import {
  LeavePolicy,
  LeaveUsage,
  LeaveYearLedger,
  leaveLedger,
  yearEntitlement,
} from '../calculators/leave-calculator';

export interface LeaveBalance {
  leaveTypeId: string;
  leaveTypeCode: string;
  leaveTypeName: string;
  isPaid: boolean;
  year: number;
  asOf: string;
  accrualMethod: string;
  entitlement: number;
  accrued: number;
  carriedIn: number;
  carriedExpired: number;
  carryExpiryDate: string | null;
  taken: number;
  pending: number;
  encashed: number;
  remaining: number;
  /** Days that would carry into next year from the year-end position. */
  carryOut: number;
}

const ACTIVE_REQUEST = [LeaveRequestStatus.DRAFT, LeaveRequestStatus.APPROVED];

export function policyOf(type: LeaveType): LeavePolicy {
  return {
    annualEntitlement: Number(type.annualEntitlement) || 0,
    seniorEntitlement: type.seniorEntitlement != null ? Number(type.seniorEntitlement) : null,
    seniorAfterYears: type.seniorAfterYears ?? null,
    accrualMethod: type.accrualMethod ?? 'annual',
    carryForward: !!type.carryForward,
    carryForwardMax: type.carryForwardMax != null ? Number(type.carryForwardMax) : null,
    carryForwardExpiryMonths: type.carryForwardExpiryMonths ?? null,
  };
}

/** Default balance date of a year: today inside the year, else its last day. */
export function defaultAsOf(year: number, now = today()): string {
  const end = `${year}-12-31`;
  if (now > end) return end;
  if (now < `${year}-01-01`) return end;
  return now;
}

@Injectable()
export class LeavesService {
  constructor(
    @InjectRepository(LeaveType)
    private readonly typeRepo: Repository<LeaveType>,
    @InjectRepository(LeaveRequest)
    private readonly requestRepo: Repository<LeaveRequest>,
    @InjectRepository(LeaveEncashment)
    private readonly encashmentRepo: Repository<LeaveEncashment>,
    @InjectRepository(PayrollAdjustment)
    private readonly adjustmentRepo: Repository<PayrollAdjustment>,
    private readonly employees: EmployeesService,
    private readonly organization: HrOrganizationService,
    private readonly settings: HrSettingsService,
    private readonly payrollLock: PayrollLockService,
    private readonly sequenceService: SequenceService,
  ) {}

  // ------------------------------------------------------------ types

  listTypes(tenantId: string) {
    return this.typeRepo.find({ where: { tenantId }, order: { code: 'ASC' } });
  }

  async getType(tenantId: string, id: string) {
    const type = await this.typeRepo.findOne({ where: { id, tenantId } });
    if (!type) throw new NotFoundException('Leave type not found');
    return type;
  }

  async createType(tenantId: string, dto: CreateLeaveTypeDto) {
    const existing = await this.typeRepo.findOne({ where: { tenantId, code: dto.code } });
    if (existing) throw new ConflictException(`Leave type code "${dto.code}" already exists`);
    return this.typeRepo.save(this.typeRepo.create({ ...dto, tenantId }));
  }

  async updateType(tenantId: string, id: string, dto: UpdateLeaveTypeDto) {
    const type = await this.getType(tenantId, id);
    if (dto.code && dto.code !== type.code) {
      const existing = await this.typeRepo.findOne({ where: { tenantId, code: dto.code } });
      if (existing) throw new ConflictException(`Leave type code "${dto.code}" already exists`);
    }
    Object.assign(type, dto);
    return this.typeRepo.save(type);
  }

  // ------------------------------------------------------------ requests

  findAll(tenantId: string, query: LeaveRequestQueryDto = {}) {
    const where: any = { tenantId };
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.status) where.status = query.status;
    return this.requestRepo.find({ where, order: { startDate: 'DESC', createdAt: 'DESC' } });
  }

  async findById(tenantId: string, id: string) {
    const request = await this.requestRepo.findOne({ where: { id, tenantId } });
    if (!request) throw new NotFoundException('Leave request not found');
    return request;
  }

  async create(tenantId: string, userId: string, dto: CreateLeaveRequestDto) {
    if (dto.endDate < dto.startDate) throw new BadRequestException('endDate cannot be before startDate');
    const employee = await this.employees.findById(tenantId, dto.employeeId);
    if (employee.status !== EmployeeStatus.ACTIVE) {
      throw new BadRequestException('Leave can only be requested for active employees');
    }
    if (dto.startDate < String(employee.hireDate)) {
      throw new BadRequestException('Leave cannot start before the hire date');
    }
    const type = await this.getType(tenantId, dto.leaveTypeId);
    if (!type.isActive) throw new BadRequestException('Leave type is inactive');
    if (dto.halfDay) {
      if (type.allowHalfDay === false) {
        throw new BadRequestException(`${type.name} cannot be taken as a half day`);
      }
      if (dto.startDate !== dto.endDate) {
        throw new BadRequestException('A half-day leave covers a single date');
      }
    }

    await this.assertNoOverlap(tenantId, dto.employeeId, dto.startDate, dto.endDate);
    const workingDays = await this.workingDays(tenantId, employee, dto.startDate, dto.endDate);
    if (workingDays <= 0) throw new BadRequestException('The requested period contains no working day');
    const days = dto.halfDay ? 0.5 : workingDays;

    const requestNumber = await this.sequenceService.next(tenantId, 'leave_request', 'LV');
    return this.requestRepo.save(
      this.requestRepo.create({
        tenantId,
        requestNumber,
        employeeId: dto.employeeId,
        leaveTypeId: dto.leaveTypeId,
        startDate: dto.startDate,
        endDate: dto.endDate,
        days,
        halfDay: !!dto.halfDay,
        halfDayPeriod: dto.halfDay ? (dto.halfDayPeriod ?? 'am') : null,
        reason: dto.reason,
        status: LeaveRequestStatus.DRAFT,
        createdBy: userId,
      }),
    );
  }

  async approve(tenantId: string, userId: string, id: string, dto: DecideLeaveDto = {}) {
    const request = await this.findById(tenantId, id);
    if (request.status !== LeaveRequestStatus.DRAFT) {
      throw new ConflictException('Only draft leave requests can be approved');
    }
    await this.payrollLock.assertOpen(
      tenantId,
      request.employeeId,
      request.startDate,
      request.endDate,
      `Leave ${request.requestNumber ?? ''}`.trim(),
    );
    const type = await this.getType(tenantId, request.leaveTypeId);
    if (Number(type.annualEntitlement) > 0 && !type.allowNegative) {
      const employee = await this.employees.findById(tenantId, request.employeeId);
      // Check each calendar year the request touches against that year's
      // balance (monthly accrual: as earned by the end of the request).
      const startYear = Number(request.startDate.slice(0, 4));
      const endYear = Number(request.endDate.slice(0, 4));
      for (let year = startYear; year <= endYear; year++) {
        const asOf = request.endDate < `${year}-12-31` ? request.endDate : `${year}-12-31`;
        const balance = await this.balanceFor(tenantId, employee, type, year, asOf);
        const requested = await this.daysInYear(tenantId, employee, request, year);
        if (requested > balance.remaining + 0.0001) {
          throw new BadRequestException(
            `Insufficient ${type.name} balance for ${year}: requested ${requested}, remaining ${balance.remaining}`,
          );
        }
      }
    }
    request.status = LeaveRequestStatus.APPROVED;
    request.decidedBy = userId;
    request.decidedAt = new Date();
    request.decisionNote = dto.note ?? null;
    return this.requestRepo.save(request);
  }

  async reject(tenantId: string, userId: string, id: string, dto: DecideLeaveDto = {}) {
    const request = await this.findById(tenantId, id);
    if (request.status !== LeaveRequestStatus.DRAFT) {
      throw new ConflictException('Only draft leave requests can be rejected');
    }
    request.status = LeaveRequestStatus.REJECTED;
    request.decidedBy = userId;
    request.decidedAt = new Date();
    request.decisionNote = dto.note ?? null;
    return this.requestRepo.save(request);
  }

  async cancel(tenantId: string, userId: string, id: string) {
    const request = await this.findById(tenantId, id);
    if (!ACTIVE_REQUEST.includes(request.status)) {
      throw new ConflictException('Only draft or approved leave requests can be cancelled');
    }
    if (request.status === LeaveRequestStatus.APPROVED) {
      await this.payrollLock.assertOpen(
        tenantId,
        request.employeeId,
        request.startDate,
        request.endDate,
        `Leave ${request.requestNumber ?? ''}`.trim(),
      );
    }
    request.status = LeaveRequestStatus.CANCELLED;
    request.decidedBy = userId;
    request.decidedAt = new Date();
    return this.requestRepo.save(request);
  }

  // ------------------------------------------------------------ balances

  /** Balances of every active leave type for one employee and year. */
  async balances(tenantId: string, employeeId: string, year: number, asOf?: string): Promise<LeaveBalance[]> {
    const employee = await this.employees.findById(tenantId, employeeId);
    const types = await this.typeRepo.find({ where: { tenantId, isActive: true }, order: { code: 'ASC' } });
    const result: LeaveBalance[] = [];
    for (const type of types) result.push(await this.balanceFor(tenantId, employee, type, year, asOf));
    return result;
  }

  /** Leave balances for all active employees (report). */
  async balancesReport(tenantId: string, year: number) {
    const employees = await this.employees.findAll(tenantId, { status: EmployeeStatus.ACTIVE });
    const types = await this.typeRepo.find({ where: { tenantId, isActive: true }, order: { code: 'ASC' } });
    const rows = [];
    for (const employee of employees) {
      const balances: LeaveBalance[] = [];
      for (const type of types) balances.push(await this.balanceFor(tenantId, employee, type, year));
      rows.push({
        employeeId: employee.id,
        employeeCode: employee.code,
        employeeName: employee.nameEn,
        employeeNameAr: employee.nameAr,
        departmentId: employee.departmentId,
        balances,
      });
    }
    return { year, rows };
  }

  /**
   * Entitlement for the year: the senior entitlement applies once the
   * employee reaches the required service years by the end of the year, and
   * the entitlement is prorated for employees hired during the year.
   */
  entitlementFor(type: LeaveType, employee: Pick<Employee, 'hireDate'>, year: number): number {
    return yearEntitlement(policyOf(type), String(employee.hireDate), year);
  }

  async balanceFor(
    tenantId: string,
    employee: Employee,
    type: LeaveType,
    year: number,
    asOf?: string,
  ): Promise<LeaveBalance> {
    const policy = policyOf(type);
    const fromYear = policy.carryForward ? Number(String(employee.hireDate).slice(0, 4)) : year;
    const requests = await this.requestRepo.find({
      where: {
        tenantId,
        employeeId: employee.id,
        leaveTypeId: type.id,
        status: In(ACTIVE_REQUEST),
        startDate: LessThanOrEqual(`${year}-12-31`),
        endDate: MoreThanOrEqual(`${Math.min(fromYear, year)}-01-01`),
      },
    });
    const taken: LeaveUsage[] = [];
    const pending: LeaveUsage[] = [];
    for (const request of requests) {
      for (const usage of await this.usageOf(tenantId, employee, request)) {
        (request.status === LeaveRequestStatus.APPROVED ? taken : pending).push(usage);
      }
    }
    const encashments = await this.encashmentRepo.find({
      where: {
        tenantId,
        employeeId: employee.id,
        leaveTypeId: type.id,
        status: LeaveEncashmentStatus.APPROVED,
      },
    });
    const date = asOf ?? defaultAsOf(year);
    const ledger: LeaveYearLedger = leaveLedger({
      policy,
      hireDate: String(employee.hireDate),
      year,
      asOf: date,
      taken,
      pending,
      encashed: encashments.map((e) => ({ year: e.year, days: Number(e.days) })),
    });
    return {
      leaveTypeId: type.id,
      leaveTypeCode: type.code,
      leaveTypeName: type.name,
      isPaid: type.isPaid,
      year,
      asOf: date,
      accrualMethod: policy.accrualMethod ?? 'annual',
      entitlement: ledger.entitlement,
      accrued: ledger.accrued,
      carriedIn: ledger.carriedIn,
      carriedExpired: ledger.carriedExpired,
      carryExpiryDate: ledger.carryExpiryDate,
      taken: ledger.taken,
      pending: ledger.pending,
      encashed: ledger.encashed,
      remaining: ledger.remaining,
      carryOut: ledger.carryOut,
    };
  }

  /**
   * Approved leave days of an employee in a date range: date -> paid flag
   * (or { paid, fraction } for half days). Used by attendance and payroll
   * (unpaid days are deducted).
   */
  async leaveDays(
    tenantId: string,
    employeeId: string,
    from: string,
    to: string,
  ): Promise<Map<string, LeaveDayValue>> {
    const requests = await this.requestRepo.find({
      where: {
        tenantId,
        employeeId,
        status: LeaveRequestStatus.APPROVED,
        startDate: LessThanOrEqual(to),
        endDate: MoreThanOrEqual(from),
      },
    });
    const map = new Map<string, LeaveDayValue>();
    if (!requests.length) return map;
    const types = await this.typeRepo.find({
      where: { tenantId, id: In([...new Set(requests.map((r) => r.leaveTypeId))]) },
    });
    const paid = new Map(types.map((t) => [t.id, t.isPaid]));
    for (const request of requests) {
      const start = request.startDate > from ? request.startDate : from;
      const end = request.endDate < to ? request.endDate : to;
      const isPaid = paid.get(request.leaveTypeId) ?? true;
      for (const date of eachDate(start, end)) {
        map.set(date, request.halfDay ? { paid: isPaid, fraction: 0.5 } : isPaid);
      }
    }
    return map;
  }

  // ------------------------------------------------------------ encashment

  findEncashments(tenantId: string, query: LeaveEncashmentQueryDto = {}) {
    const where: any = { tenantId };
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.period) where.period = query.period;
    return this.encashmentRepo.find({ where, order: { createdAt: 'DESC' } });
  }

  /**
   * Pays out unused leave days: checks the remaining balance of the year and
   * creates a taxable payroll addition for the chosen month.
   */
  async createEncashment(tenantId: string, userId: string, dto: CreateLeaveEncashmentDto) {
    const employee = await this.employees.findById(tenantId, dto.employeeId);
    const type = await this.getType(tenantId, dto.leaveTypeId);
    if (!type.encashable) throw new BadRequestException(`${type.name} is not encashable`);
    if (!type.isPaid) throw new BadRequestException('Only paid leave can be encashed');
    const [periodYear, periodMonth] = dto.period.split('-').map(Number);
    const periodEnd = new Date(Date.UTC(periodYear, periodMonth, 0)).toISOString().slice(0, 10);
    await this.payrollLock.assertOpen(tenantId, employee.id, `${dto.period}-01`, periodEnd, 'The encashment');

    const balance = await this.balanceFor(tenantId, employee, type, dto.year);
    const days = round(dto.days, 2);
    if (days > balance.remaining + 0.0001) {
      throw new BadRequestException(
        `Only ${balance.remaining} ${type.name} day(s) remain for ${dto.year}`,
      );
    }
    const rules = await this.settings.getRules(tenantId);
    const dailyRate = round(
      dto.dailyRate ?? this.employees.monthlyWage(employee) / rules.general.daysPerMonth,
      4,
    );
    const amount = round(days * dailyRate, 2);
    if (!(amount > 0)) throw new BadRequestException('The encashment amount must be positive');

    const adjustment = await this.adjustmentRepo.save(
      this.adjustmentRepo.create({
        tenantId,
        employeeId: employee.id,
        period: dto.period,
        kind: AdjustmentKind.ADDITION,
        category: 'leave_encashment',
        description: `Leave encashment ${type.name} ${dto.year} (${days} day(s))`,
        amount,
        taxable: true,
        createdBy: userId,
      }),
    );
    return this.encashmentRepo.save(
      this.encashmentRepo.create({
        tenantId,
        employeeId: employee.id,
        leaveTypeId: type.id,
        year: dto.year,
        days,
        dailyRate,
        amount,
        period: dto.period,
        status: LeaveEncashmentStatus.APPROVED,
        payrollAdjustmentId: adjustment.id,
        notes: dto.notes,
        createdBy: userId,
      }),
    );
  }

  async cancelEncashment(tenantId: string, id: string) {
    const encashment = await this.encashmentRepo.findOne({ where: { id, tenantId } });
    if (!encashment) throw new NotFoundException('Leave encashment not found');
    if (encashment.status !== LeaveEncashmentStatus.APPROVED) {
      throw new ConflictException('The encashment is already cancelled');
    }
    if (encashment.payrollAdjustmentId) {
      const adjustment = await this.adjustmentRepo.findOne({
        where: { id: encashment.payrollAdjustmentId, tenantId },
      });
      if (adjustment?.payrollRunId) {
        throw new ConflictException('The encashment was paid by an approved payroll run; reverse it first');
      }
      if (adjustment) await this.adjustmentRepo.delete({ id: adjustment.id, tenantId });
    }
    encashment.status = LeaveEncashmentStatus.CANCELLED;
    return this.encashmentRepo.save(encashment);
  }

  // ------------------------------------------------------------ helpers

  /**
   * Balance consumption of a request per calendar year it touches, dated at
   * its first day in that year (carry-forward expiry is evaluated on it).
   */
  private async usageOf(tenantId: string, employee: Employee, request: LeaveRequest): Promise<LeaveUsage[]> {
    const startYear = Number(String(request.startDate).slice(0, 4));
    const endYear = Number(String(request.endDate).slice(0, 4));
    const out: LeaveUsage[] = [];
    for (let year = startYear; year <= endYear; year++) {
      const days = await this.daysInYear(tenantId, employee, request, year);
      if (days > 0) {
        const first = request.startDate > `${year}-01-01` ? request.startDate : `${year}-01-01`;
        out.push({ date: String(first), days });
      }
    }
    return out;
  }

  private async daysInYear(
    tenantId: string,
    employee: Employee,
    request: LeaveRequest,
    year: number,
  ): Promise<number> {
    const start = request.startDate > `${year}-01-01` ? request.startDate : `${year}-01-01`;
    const end = request.endDate < `${year}-12-31` ? request.endDate : `${year}-12-31`;
    if (end < start) return 0;
    if (start === request.startDate && end === request.endDate) return Number(request.days);
    return this.workingDays(tenantId, employee, start, end);
  }

  private async workingDays(tenantId: string, employee: Employee, from: string, to: string) {
    const schedule = await this.organization.resolveSchedule(tenantId, employee);
    const holidays = await this.organization.holidaySet(tenantId, from, to);
    return eachDate(from, to).filter(
      (d) => !schedule.weekendDays.includes(weekday(d)) && !holidays.has(d),
    ).length;
  }

  private async assertNoOverlap(tenantId: string, employeeId: string, from: string, to: string) {
    const overlapping = await this.requestRepo.findOne({
      where: {
        tenantId,
        employeeId,
        status: In(ACTIVE_REQUEST),
        startDate: LessThanOrEqual(to),
        endDate: MoreThanOrEqual(from),
      },
    });
    if (overlapping) {
      throw new ConflictException(
        `Overlaps leave request ${overlapping.requestNumber} (${overlapping.startDate} - ${overlapping.endDate})`,
      );
    }
  }
}
