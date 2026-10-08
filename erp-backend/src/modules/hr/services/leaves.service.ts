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
import {
  CreateLeaveRequestDto,
  CreateLeaveTypeDto,
  DecideLeaveDto,
  LeaveRequestQueryDto,
  UpdateLeaveTypeDto,
} from '../dto/leave.dto';
import { HrOrganizationService } from './hr-organization.service';
import { EmployeesService } from './employees.service';
import { SequenceService } from '@shared/services/sequence.service';
import { round } from '@shared/utils/document-totals.util';
import { eachDate, weekday } from '../calculators/attendance-calculator';

export interface LeaveBalance {
  leaveTypeId: string;
  leaveTypeCode: string;
  leaveTypeName: string;
  isPaid: boolean;
  year: number;
  entitlement: number;
  taken: number;
  pending: number;
  remaining: number;
}

const ACTIVE_REQUEST = [LeaveRequestStatus.DRAFT, LeaveRequestStatus.APPROVED];

@Injectable()
export class LeavesService {
  constructor(
    @InjectRepository(LeaveType)
    private readonly typeRepo: Repository<LeaveType>,
    @InjectRepository(LeaveRequest)
    private readonly requestRepo: Repository<LeaveRequest>,
    private readonly employees: EmployeesService,
    private readonly organization: HrOrganizationService,
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

    await this.assertNoOverlap(tenantId, dto.employeeId, dto.startDate, dto.endDate);
    const days = await this.workingDays(tenantId, employee, dto.startDate, dto.endDate);
    if (days <= 0) throw new BadRequestException('The requested period contains no working day');

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
    const type = await this.getType(tenantId, request.leaveTypeId);
    if (Number(type.annualEntitlement) > 0 && !type.allowNegative) {
      const employee = await this.employees.findById(tenantId, request.employeeId);
      // Check each calendar year the request touches against that year's balance.
      const startYear = Number(request.startDate.slice(0, 4));
      const endYear = Number(request.endDate.slice(0, 4));
      for (let year = startYear; year <= endYear; year++) {
        const balance = await this.balanceFor(tenantId, employee, type, year);
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
    request.status = LeaveRequestStatus.CANCELLED;
    request.decidedBy = userId;
    request.decidedAt = new Date();
    return this.requestRepo.save(request);
  }

  // ------------------------------------------------------------ balances

  /** Balances of every leave type with an entitlement for one employee and year. */
  async balances(tenantId: string, employeeId: string, year: number): Promise<LeaveBalance[]> {
    const employee = await this.employees.findById(tenantId, employeeId);
    const types = await this.typeRepo.find({ where: { tenantId, isActive: true }, order: { code: 'ASC' } });
    const result: LeaveBalance[] = [];
    for (const type of types) result.push(await this.balanceFor(tenantId, employee, type, year));
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
    const base = Number(type.annualEntitlement) || 0;
    if (base <= 0) return 0;
    const hire = String(employee.hireDate);
    const yearEnd = `${year}-12-31`;
    if (hire > yearEnd) return 0;
    let entitlement = base;
    if (type.seniorEntitlement != null && type.seniorAfterYears != null) {
      const serviceYears =
        (new Date(`${yearEnd}T00:00:00Z`).getTime() - new Date(`${hire}T00:00:00Z`).getTime()) /
        (365.25 * 86400000);
      if (serviceYears >= type.seniorAfterYears) entitlement = Number(type.seniorEntitlement);
    }
    if (hire > `${year}-01-01`) {
      const daysInYear = eachDate(`${year}-01-01`, yearEnd).length;
      const remainingDays = eachDate(hire, yearEnd).length;
      entitlement = (entitlement * remainingDays) / daysInYear;
    }
    return round(entitlement, 2);
  }

  async balanceFor(
    tenantId: string,
    employee: Employee,
    type: LeaveType,
    year: number,
  ): Promise<LeaveBalance> {
    const requests = await this.requestRepo.find({
      where: {
        tenantId,
        employeeId: employee.id,
        leaveTypeId: type.id,
        status: In(ACTIVE_REQUEST),
        startDate: LessThanOrEqual(`${year}-12-31`),
        endDate: MoreThanOrEqual(`${year}-01-01`),
      },
    });
    let taken = 0;
    let pending = 0;
    for (const request of requests) {
      const days = await this.daysInYear(tenantId, employee, request, year);
      if (request.status === LeaveRequestStatus.APPROVED) taken += days;
      else pending += days;
    }
    const entitlement = this.entitlementFor(type, employee, year);
    return {
      leaveTypeId: type.id,
      leaveTypeCode: type.code,
      leaveTypeName: type.name,
      isPaid: type.isPaid,
      year,
      entitlement,
      taken: round(taken, 2),
      pending: round(pending, 2),
      remaining: round(entitlement - taken, 2),
    };
  }

  /**
   * Approved leave days of an employee in a date range: date -> paid flag.
   * Used by attendance and payroll (unpaid days are deducted).
   */
  async leaveDays(
    tenantId: string,
    employeeId: string,
    from: string,
    to: string,
  ): Promise<Map<string, boolean>> {
    const requests = await this.requestRepo.find({
      where: {
        tenantId,
        employeeId,
        status: LeaveRequestStatus.APPROVED,
        startDate: LessThanOrEqual(to),
        endDate: MoreThanOrEqual(from),
      },
    });
    const map = new Map<string, boolean>();
    if (!requests.length) return map;
    const types = await this.typeRepo.find({
      where: { tenantId, id: In([...new Set(requests.map((r) => r.leaveTypeId))]) },
    });
    const paid = new Map(types.map((t) => [t.id, t.isPaid]));
    for (const request of requests) {
      const start = request.startDate > from ? request.startDate : from;
      const end = request.endDate < to ? request.endDate : to;
      for (const date of eachDate(start, end)) map.set(date, paid.get(request.leaveTypeId) ?? true);
    }
    return map;
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
