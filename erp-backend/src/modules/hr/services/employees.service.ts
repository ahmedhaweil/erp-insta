import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { Employee, EmployeeStatus, PayrollCountry } from '../entities/employee.entity';
import { Branch } from '@modules/tenants/entities/branch.entity';
import { User } from '@modules/auth/entities/user.entity';
import {
  CreateEmployeeDto,
  EmployeeQueryDto,
  GratuityDto,
  TerminateEmployeeDto,
  UpdateEmployeeDto,
} from '../dto/employee.dto';
import { HrOrganizationService } from './hr-organization.service';
import { HrSettingsService } from './hr-settings.service';
import { SequenceService } from '@shared/services/sequence.service';
import { round, today } from '@shared/utils/document-totals.util';

@Injectable()
export class EmployeesService {
  constructor(
    @InjectRepository(Employee)
    private readonly employeeRepo: Repository<Employee>,
    @InjectRepository(Branch)
    private readonly branchRepo: Repository<Branch>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly organization: HrOrganizationService,
    private readonly settings: HrSettingsService,
    private readonly sequenceService: SequenceService,
  ) {}

  findAll(tenantId: string, query: EmployeeQueryDto = {}): Promise<Employee[]> {
    const qb = this.employeeRepo
      .createQueryBuilder('e')
      .where('e.tenant_id = :tenantId', { tenantId })
      .orderBy('e.code', 'ASC');
    if (query.status) qb.andWhere('e.status = :status', { status: query.status });
    if (query.branchId) qb.andWhere('e.branch_id = :branchId', { branchId: query.branchId });
    if (query.departmentId) {
      qb.andWhere('e.department_id = :departmentId', { departmentId: query.departmentId });
    }
    if (query.search) {
      const search = `%${query.search}%`;
      qb.andWhere(
        new Brackets((w) =>
          w
            .where('e.code ILIKE :search', { search })
            .orWhere('e.name_en ILIKE :search', { search })
            .orWhere('e.name_ar ILIKE :search', { search })
            .orWhere('e.national_id ILIKE :search', { search }),
        ),
      );
    }
    return qb.getMany();
  }

  async findById(tenantId: string, id: string): Promise<Employee> {
    const employee = await this.employeeRepo.findOne({ where: { id, tenantId } });
    if (!employee) throw new NotFoundException('Employee not found');
    return employee;
  }

  async create(tenantId: string, dto: CreateEmployeeDto): Promise<Employee> {
    const code = dto.code?.trim() || (await this.sequenceService.next(tenantId, 'employee', 'EMP'));
    const existing = await this.employeeRepo.findOne({ where: { tenantId, code } });
    if (existing) throw new ConflictException(`Employee code "${code}" already exists`);
    await this.validateReferences(tenantId, dto);

    return this.employeeRepo.save(
      this.employeeRepo.create({
        ...dto,
        tenantId,
        code,
        nationality: (dto.nationality ?? (dto.payrollCountry === PayrollCountry.SA ? 'SA' : 'EG')).toUpperCase(),
        allowances: this.normalizeAllowances(dto.allowances),
        status: EmployeeStatus.ACTIVE,
      }),
    );
  }

  async update(tenantId: string, id: string, dto: UpdateEmployeeDto): Promise<Employee> {
    const employee = await this.findById(tenantId, id);
    await this.validateReferences(tenantId, dto, id);
    Object.assign(employee, dto);
    if (dto.allowances) employee.allowances = this.normalizeAllowances(dto.allowances);
    if (dto.nationality) employee.nationality = dto.nationality.toUpperCase();
    return this.employeeRepo.save(employee);
  }

  async terminate(tenantId: string, id: string, dto: TerminateEmployeeDto): Promise<Employee> {
    const employee = await this.findById(tenantId, id);
    if (employee.status === EmployeeStatus.TERMINATED) {
      throw new ConflictException('Employee is already terminated');
    }
    if (dto.terminationDate < String(employee.hireDate)) {
      throw new BadRequestException('Termination date cannot be before the hire date');
    }
    employee.status = EmployeeStatus.TERMINATED;
    employee.terminationDate = dto.terminationDate;
    employee.terminationReason = dto.terminationReason;
    return this.employeeRepo.save(employee);
  }

  /** Fixed monthly wage: basic salary + fixed allowances. */
  monthlyWage(employee: Employee): number {
    return round(
      Number(employee.basicSalary) +
        (employee.allowances ?? []).reduce((s, a) => s + Number(a.amount || 0), 0),
      4,
    );
  }

  async gratuity(tenantId: string, dto: GratuityDto) {
    const employee = dto.employeeId ? await this.findById(tenantId, dto.employeeId) : null;
    const country = dto.country ?? employee?.payrollCountry;
    const startDate = dto.startDate ?? employee?.hireDate;
    const endDate = dto.endDate ?? employee?.terminationDate ?? today();
    const monthlyWage = dto.monthlyWage ?? (employee ? this.monthlyWage(employee) : undefined);
    if (!country || !startDate || monthlyWage === undefined) {
      throw new BadRequestException(
        'Provide employeeId, or country, startDate and monthlyWage',
      );
    }
    if (endDate < startDate) throw new BadRequestException('endDate cannot be before startDate');
    const calculator = await this.settings.getCalculator(tenantId);
    return {
      employeeId: employee?.id ?? null,
      reason: dto.reason,
      startDate,
      endDate,
      ...calculator.gratuity({
        country: country as 'EG' | 'SA',
        monthlyWage,
        startDate: String(startDate),
        endDate: String(endDate),
        reason: dto.reason,
      }),
    };
  }

  private normalizeAllowances(allowances?: { code: string; name: string; amount: number }[]) {
    const list = (allowances ?? []).map((a) => ({
      code: a.code.trim().toLowerCase(),
      name: a.name,
      amount: round(Number(a.amount), 4),
    }));
    const codes = new Set<string>();
    for (const a of list) {
      if (codes.has(a.code)) throw new BadRequestException(`Duplicate allowance code "${a.code}"`);
      codes.add(a.code);
    }
    return list;
  }

  private async validateReferences(
    tenantId: string,
    dto: Partial<CreateEmployeeDto>,
    selfId?: string,
  ): Promise<void> {
    if (dto.departmentId) await this.organization.getDepartment(tenantId, dto.departmentId);
    if (dto.jobTitleId) await this.organization.getJobTitle(tenantId, dto.jobTitleId);
    if (dto.workScheduleId) await this.organization.getSchedule(tenantId, dto.workScheduleId);
    if (dto.branchId) {
      const branch = await this.branchRepo.findOne({ where: { id: dto.branchId, tenantId } });
      if (!branch) throw new NotFoundException('Branch not found');
    }
    if (dto.managerId) {
      if (dto.managerId === selfId) throw new BadRequestException('An employee cannot manage themselves');
      await this.findById(tenantId, dto.managerId);
    }
    if (dto.userId) {
      const user = await this.userRepo.findOne({ where: { id: dto.userId, tenantId } });
      if (!user) throw new NotFoundException('User not found');
      const linked = await this.employeeRepo.findOne({ where: { tenantId, userId: dto.userId } });
      if (linked && linked.id !== selfId) {
        throw new ConflictException(`User is already linked to employee ${linked.code}`);
      }
    }
  }
}
