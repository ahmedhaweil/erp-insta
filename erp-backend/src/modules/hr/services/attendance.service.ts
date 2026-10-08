import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { AttendanceRecord, AttendanceSource } from '../entities/attendance-record.entity';
import { Employee, EmployeeStatus } from '../entities/employee.entity';
import {
  AttendanceQueryDto,
  AttendanceSummaryQueryDto,
  ImportAttendanceDto,
  UpsertAttendanceDto,
} from '../dto/attendance.dto';
import { EmployeesService } from './employees.service';
import { LeavesService } from './leaves.service';
import { HrOrganizationService } from './hr-organization.service';
import {
  AttendanceSummary,
  ScheduleInput,
  computeAttendance,
} from '../calculators/attendance-calculator';

@Injectable()
export class AttendanceService {
  constructor(
    @InjectRepository(AttendanceRecord)
    private readonly recordRepo: Repository<AttendanceRecord>,
    @InjectRepository(Employee)
    private readonly employeeRepo: Repository<Employee>,
    private readonly employees: EmployeesService,
    private readonly leaves: LeavesService,
    private readonly organization: HrOrganizationService,
  ) {}

  findAll(tenantId: string, query: AttendanceQueryDto) {
    const where: any = { tenantId, date: Between(query.from, query.to) };
    if (query.employeeId) where.employeeId = query.employeeId;
    return this.recordRepo.find({ where, order: { date: 'ASC' } });
  }

  async upsert(tenantId: string, dto: UpsertAttendanceDto) {
    const employee = await this.employees.findById(tenantId, dto.employeeId);
    this.assertEmployed(employee, dto.date);
    return this.save(tenantId, employee.id, dto, AttendanceSource.MANUAL);
  }

  /**
   * Bulk import (e.g. a fingerprint device export). Rows are matched by
   * employee id or code and upserted per employee/date; invalid rows are
   * reported without aborting the rest of the import.
   */
  async import(tenantId: string, dto: ImportAttendanceDto) {
    const codes = [...new Set(dto.records.map((r) => r.employeeCode).filter(Boolean))] as string[];
    const ids = [...new Set(dto.records.map((r) => r.employeeId).filter(Boolean))] as string[];
    const employees = await this.employeeRepo.find({
      where: [
        ...(codes.length ? [{ tenantId, code: In(codes) }] : []),
        ...(ids.length ? [{ tenantId, id: In(ids) }] : []),
      ],
    });
    const byCode = new Map(employees.map((e) => [e.code, e]));
    const byId = new Map(employees.map((e) => [e.id, e]));

    let imported = 0;
    const errors: { row: number; error: string }[] = [];
    for (const [index, row] of dto.records.entries()) {
      const employee = row.employeeId ? byId.get(row.employeeId) : byCode.get(row.employeeCode ?? '');
      if (!employee) {
        errors.push({ row: index, error: `Unknown employee ${row.employeeId ?? row.employeeCode ?? ''}` });
        continue;
      }
      try {
        this.assertEmployed(employee, row.date);
        await this.save(tenantId, employee.id, row, AttendanceSource.IMPORT);
        imported += 1;
      } catch (err) {
        errors.push({ row: index, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return { received: dto.records.length, imported, failed: errors.length, errors };
  }

  async remove(tenantId: string, id: string) {
    await this.recordRepo.delete({ id, tenantId });
    return { deleted: true };
  }

  /** Computes absence days, late minutes and overtime of one employee. */
  async summarize(
    tenantId: string,
    employee: Employee,
    from: string,
    to: string,
  ): Promise<AttendanceSummary & { schedule: ScheduleInput }> {
    const [schedule, holidays, leaveDays, records] = await Promise.all([
      this.organization.resolveSchedule(tenantId, employee),
      this.organization.holidaySet(tenantId, from, to),
      this.leaves.leaveDays(tenantId, employee.id, from, to),
      this.recordRepo.find({ where: { tenantId, employeeId: employee.id, date: Between(from, to) } }),
    ]);
    const summary = computeAttendance({
      from,
      to,
      schedule,
      holidays,
      leaveDays,
      trackAttendance: employee.trackAttendance,
      records: records.map((r) => ({
        date: String(r.date).slice(0, 10),
        checkIn: r.checkIn,
        checkOut: r.checkOut,
      })),
    });
    return { ...summary, schedule };
  }

  /** Period summary for one or many employees (without the per-day detail). */
  async summary(tenantId: string, query: AttendanceSummaryQueryDto) {
    if (query.to < query.from) throw new BadRequestException('"to" cannot be before "from"');
    const employees = query.employeeId
      ? [await this.employees.findById(tenantId, query.employeeId)]
      : await this.employees.findAll(tenantId, {
          status: EmployeeStatus.ACTIVE,
          branchId: query.branchId,
          departmentId: query.departmentId,
        });
    const rows = [];
    for (const employee of employees) {
      const from = query.from > String(employee.hireDate) ? query.from : String(employee.hireDate);
      const to =
        employee.terminationDate && String(employee.terminationDate) < query.to
          ? String(employee.terminationDate)
          : query.to;
      if (to < from) continue;
      const { schedule: _schedule, ...summary } = await this.summarize(tenantId, employee, from, to);
      rows.push({
        employeeId: employee.id,
        employeeCode: employee.code,
        employeeName: employee.nameEn,
        trackAttendance: employee.trackAttendance,
        ...summary,
        days: query.employeeId ? summary.days : undefined,
      });
    }
    return rows;
  }

  private async save(
    tenantId: string,
    employeeId: string,
    input: { date: string; checkIn?: string; checkOut?: string; notes?: string },
    source: AttendanceSource,
  ) {
    if (input.checkOut && !input.checkIn) {
      throw new BadRequestException('checkOut requires checkIn');
    }
    let record = await this.recordRepo.findOne({ where: { tenantId, employeeId, date: input.date } });
    if (!record) record = this.recordRepo.create({ tenantId, employeeId, date: input.date });
    record.checkIn = input.checkIn ?? null;
    record.checkOut = input.checkOut ?? null;
    record.notes = input.notes as string;
    record.source = source;
    return this.recordRepo.save(record);
  }

  private assertEmployed(employee: Employee, date: string) {
    if (date < String(employee.hireDate)) {
      throw new BadRequestException(`${employee.code}: ${date} is before the hire date`);
    }
    if (employee.terminationDate && date > String(employee.terminationDate)) {
      throw new BadRequestException(`${employee.code}: ${date} is after the termination date`);
    }
  }
}
