import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { Department } from '../entities/department.entity';
import { JobTitle } from '../entities/job-title.entity';
import { WorkSchedule } from '../entities/work-schedule.entity';
import { PublicHoliday } from '../entities/public-holiday.entity';
import { Employee } from '../entities/employee.entity';
import {
  CreateDepartmentDto,
  CreateJobTitleDto,
  CreatePublicHolidayDto,
  CreateWorkScheduleDto,
  UpdateDepartmentDto,
  UpdateJobTitleDto,
  UpdateWorkScheduleDto,
} from '../dto/organization.dto';
import { ScheduleInput } from '../calculators/attendance-calculator';

/** Built-in schedule when the tenant has none: 8h from 09:00, Friday/Saturday weekend. */
export const FALLBACK_SCHEDULE: ScheduleInput = {
  dailyHours: 8,
  startTime: '09:00',
  weekendDays: [5, 6],
  graceMinutes: 0,
};

/** Departments, job titles, work schedules and public holidays. */
@Injectable()
export class HrOrganizationService {
  constructor(
    @InjectRepository(Department)
    private readonly departmentRepo: Repository<Department>,
    @InjectRepository(JobTitle)
    private readonly jobTitleRepo: Repository<JobTitle>,
    @InjectRepository(WorkSchedule)
    private readonly scheduleRepo: Repository<WorkSchedule>,
    @InjectRepository(PublicHoliday)
    private readonly holidayRepo: Repository<PublicHoliday>,
  ) {}

  // ------------------------------------------------------------ departments

  listDepartments(tenantId: string) {
    return this.departmentRepo.find({ where: { tenantId }, order: { code: 'ASC' } });
  }

  async getDepartment(tenantId: string, id: string) {
    const department = await this.departmentRepo.findOne({ where: { id, tenantId } });
    if (!department) throw new NotFoundException('Department not found');
    return department;
  }

  async createDepartment(tenantId: string, dto: CreateDepartmentDto) {
    await this.assertUnique(this.departmentRepo, tenantId, dto.code, 'Department');
    if (dto.parentId) await this.getDepartment(tenantId, dto.parentId);
    return this.departmentRepo.save(this.departmentRepo.create({ ...dto, tenantId }));
  }

  async updateDepartment(tenantId: string, id: string, dto: UpdateDepartmentDto) {
    const department = await this.getDepartment(tenantId, id);
    if (dto.code && dto.code !== department.code) {
      await this.assertUnique(this.departmentRepo, tenantId, dto.code, 'Department');
    }
    if (dto.parentId) {
      if (dto.parentId === id) throw new ConflictException('A department cannot be its own parent');
      await this.getDepartment(tenantId, dto.parentId);
    }
    Object.assign(department, dto);
    return this.departmentRepo.save(department);
  }

  // ------------------------------------------------------------ job titles

  listJobTitles(tenantId: string) {
    return this.jobTitleRepo.find({ where: { tenantId }, order: { code: 'ASC' } });
  }

  async getJobTitle(tenantId: string, id: string) {
    const jobTitle = await this.jobTitleRepo.findOne({ where: { id, tenantId } });
    if (!jobTitle) throw new NotFoundException('Job title not found');
    return jobTitle;
  }

  async createJobTitle(tenantId: string, dto: CreateJobTitleDto) {
    await this.assertUnique(this.jobTitleRepo, tenantId, dto.code, 'Job title');
    return this.jobTitleRepo.save(this.jobTitleRepo.create({ ...dto, tenantId }));
  }

  async updateJobTitle(tenantId: string, id: string, dto: UpdateJobTitleDto) {
    const jobTitle = await this.getJobTitle(tenantId, id);
    if (dto.code && dto.code !== jobTitle.code) {
      await this.assertUnique(this.jobTitleRepo, tenantId, dto.code, 'Job title');
    }
    Object.assign(jobTitle, dto);
    return this.jobTitleRepo.save(jobTitle);
  }

  // ------------------------------------------------------------ schedules

  listSchedules(tenantId: string) {
    return this.scheduleRepo.find({ where: { tenantId }, order: { name: 'ASC' } });
  }

  async getSchedule(tenantId: string, id: string) {
    const schedule = await this.scheduleRepo.findOne({ where: { id, tenantId } });
    if (!schedule) throw new NotFoundException('Work schedule not found');
    return schedule;
  }

  async createSchedule(tenantId: string, dto: CreateWorkScheduleDto) {
    if (dto.isDefault) await this.scheduleRepo.update({ tenantId }, { isDefault: false });
    return this.scheduleRepo.save(this.scheduleRepo.create({ ...dto, tenantId }));
  }

  async updateSchedule(tenantId: string, id: string, dto: UpdateWorkScheduleDto) {
    const schedule = await this.getSchedule(tenantId, id);
    if (dto.isDefault) await this.scheduleRepo.update({ tenantId }, { isDefault: false });
    Object.assign(schedule, dto);
    return this.scheduleRepo.save(schedule);
  }

  /** Employee schedule, else the tenant default schedule, else the built-in one. */
  async resolveSchedule(
    tenantId: string,
    employee: Pick<Employee, 'workScheduleId'>,
  ): Promise<ScheduleInput> {
    const schedule =
      (employee.workScheduleId
        ? await this.scheduleRepo.findOne({ where: { id: employee.workScheduleId, tenantId } })
        : null) ?? (await this.scheduleRepo.findOne({ where: { tenantId, isDefault: true } }));
    if (!schedule) return FALLBACK_SCHEDULE;
    return {
      dailyHours: Number(schedule.dailyHours),
      startTime: schedule.startTime,
      weekendDays: (schedule.weekendDays ?? []).map(Number),
      graceMinutes: Number(schedule.graceMinutes ?? 0),
    };
  }

  // ------------------------------------------------------------ holidays

  listHolidays(tenantId: string, year?: number) {
    const where: any = { tenantId };
    if (year) where.date = Between(`${year}-01-01`, `${year}-12-31`);
    return this.holidayRepo.find({ where, order: { date: 'ASC' } });
  }

  async createHoliday(tenantId: string, dto: CreatePublicHolidayDto) {
    const existing = await this.holidayRepo.findOne({ where: { tenantId, date: dto.date } });
    if (existing) throw new ConflictException(`A holiday already exists on ${dto.date}`);
    return this.holidayRepo.save(this.holidayRepo.create({ ...dto, tenantId }));
  }

  async deleteHoliday(tenantId: string, id: string) {
    const holiday = await this.holidayRepo.findOne({ where: { id, tenantId } });
    if (!holiday) throw new NotFoundException('Holiday not found');
    await this.holidayRepo.delete({ id, tenantId });
    return { deleted: true };
  }

  async holidaySet(tenantId: string, from: string, to: string): Promise<Set<string>> {
    const holidays = await this.holidayRepo.find({ where: { tenantId, date: Between(from, to) } });
    return new Set(holidays.map((h) => String(h.date).slice(0, 10)));
  }

  private async assertUnique(
    repo: Repository<Department | JobTitle>,
    tenantId: string,
    code: string,
    label: string,
  ) {
    const existing = await repo.findOne({ where: { tenantId, code } });
    if (existing) throw new ConflictException(`${label} code "${code}" already exists`);
  }
}
