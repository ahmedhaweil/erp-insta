import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { OvertimeRequest, OvertimeRequestStatus } from '../entities/overtime-request.entity';
import { CreateOvertimeRequestDto, OvertimeQueryDto } from '../dto/overtime.dto';
import { DecideLeaveDto } from '../dto/leave.dto';
import { EmployeesService } from './employees.service';
import { PayrollLockService } from './payroll-lock.service';
import { round } from '@shared/utils/document-totals.util';
import { ApprovedOvertime } from '../calculators/overtime-calculator';

/** Overtime requests: draft -> approved / rejected (and cancel). */
@Injectable()
export class OvertimeService {
  constructor(
    @InjectRepository(OvertimeRequest)
    private readonly requestRepo: Repository<OvertimeRequest>,
    private readonly employees: EmployeesService,
    private readonly payrollLock: PayrollLockService,
  ) {}

  findAll(tenantId: string, query: OvertimeQueryDto = {}) {
    const where: any = { tenantId };
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.status) where.status = query.status;
    if (query.from && query.to) where.date = Between(query.from, query.to);
    return this.requestRepo.find({ where, order: { date: 'DESC', createdAt: 'DESC' } });
  }

  async findById(tenantId: string, id: string) {
    const request = await this.requestRepo.findOne({ where: { id, tenantId } });
    if (!request) throw new NotFoundException('Overtime request not found');
    return request;
  }

  async create(tenantId: string, userId: string, dto: CreateOvertimeRequestDto) {
    const employee = await this.employees.findById(tenantId, dto.employeeId);
    if (dto.date < String(employee.hireDate)) {
      throw new BadRequestException('Overtime cannot be before the hire date');
    }
    if (employee.terminationDate && dto.date > String(employee.terminationDate)) {
      throw new BadRequestException('Overtime cannot be after the termination date');
    }
    await this.payrollLock.assertOpen(tenantId, employee.id, dto.date, dto.date, 'The overtime');
    return this.requestRepo.save(
      this.requestRepo.create({
        tenantId,
        employeeId: employee.id,
        date: dto.date,
        hours: round(dto.hours, 2),
        reason: dto.reason,
        status: OvertimeRequestStatus.DRAFT,
        createdBy: userId,
      }),
    );
  }

  async approve(tenantId: string, userId: string, id: string, dto: DecideLeaveDto = {}) {
    return this.decide(tenantId, userId, id, OvertimeRequestStatus.APPROVED, dto.note);
  }

  async reject(tenantId: string, userId: string, id: string, dto: DecideLeaveDto = {}) {
    return this.decide(tenantId, userId, id, OvertimeRequestStatus.REJECTED, dto.note);
  }

  async cancel(tenantId: string, userId: string, id: string) {
    const request = await this.findById(tenantId, id);
    if (![OvertimeRequestStatus.DRAFT, OvertimeRequestStatus.APPROVED].includes(request.status)) {
      throw new ConflictException('Only draft or approved overtime can be cancelled');
    }
    if (request.status === OvertimeRequestStatus.APPROVED) {
      await this.payrollLock.assertOpen(tenantId, request.employeeId, request.date, request.date, 'The overtime');
    }
    request.status = OvertimeRequestStatus.CANCELLED;
    request.decidedBy = userId;
    request.decidedAt = new Date();
    return this.requestRepo.save(request);
  }

  /** Approved overtime of an employee in a date range (payroll input). */
  async approvedBetween(tenantId: string, employeeId: string, from: string, to: string): Promise<ApprovedOvertime[]> {
    const requests = await this.requestRepo.find({
      where: { tenantId, employeeId, status: OvertimeRequestStatus.APPROVED, date: Between(from, to) },
    });
    return requests.map((r) => ({ date: String(r.date).slice(0, 10), hours: Number(r.hours) }));
  }

  private async decide(
    tenantId: string,
    userId: string,
    id: string,
    status: OvertimeRequestStatus,
    note?: string,
  ) {
    const request = await this.findById(tenantId, id);
    if (request.status !== OvertimeRequestStatus.DRAFT) {
      throw new ConflictException('Only draft overtime requests can be decided');
    }
    if (status === OvertimeRequestStatus.APPROVED) {
      await this.payrollLock.assertOpen(tenantId, request.employeeId, request.date, request.date, 'The overtime');
    }
    request.status = status;
    request.decidedBy = userId;
    request.decidedAt = new Date();
    request.decisionNote = note ?? null;
    return this.requestRepo.save(request);
  }
}
