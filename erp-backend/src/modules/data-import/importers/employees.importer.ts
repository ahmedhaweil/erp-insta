import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ContractType,
  Employee,
  EmployeeIdType,
  PayrollCountry,
} from '@modules/hr/entities/employee.entity';
import { Department } from '@modules/hr/entities/department.entity';
import { JobTitle } from '@modules/hr/entities/job-title.entity';
import { Branch } from '@modules/tenants/entities/branch.entity';
import { EmployeesService } from '@modules/hr/services/employees.service';
import { ImportEntity } from '../entities/import-job.entity';
import type { ColumnSpec, ParsedRow } from '../utils/spreadsheet.util';
import {
  ImportContext,
  Importer,
  IssueList,
  PlannedRow,
  ValidationOutcome,
  checkDuplicateCodes,
  has,
  keyOf,
  v,
} from './importer.types';

const ALLOWANCES = [
  { key: 'housingAllowance', code: 'housing', name: 'Housing allowance', ar: 'بدل سكن' },
  { key: 'transportAllowance', code: 'transport', name: 'Transport allowance', ar: 'بدل انتقال' },
  { key: 'otherAllowance', code: 'other', name: 'Other allowance', ar: 'بدلات أخرى' },
];

export const EMPLOYEE_COLUMNS: ColumnSpec[] = [
  {
    key: 'code',
    label: { en: 'Employee code', ar: 'كود الموظف' },
    note: { en: 'Generated when empty (always creates)', ar: 'يُولّد تلقائيًا إذا تُرك فارغًا' },
  },
  { key: 'nameEn', label: { en: 'English name', ar: 'الاسم الإنجليزي' }, required: true, width: 30 },
  { key: 'nameAr', label: { en: 'Arabic name', ar: 'الاسم العربي' }, width: 30 },
  {
    key: 'idType',
    label: { en: 'ID type', ar: 'نوع الهوية' },
    type: 'enum',
    values: [
      { value: EmployeeIdType.NATIONAL_ID, aliases: ['رقم قومي', 'هوية وطنية', 'national id'] },
      { value: EmployeeIdType.IQAMA, aliases: ['إقامة', 'اقامة'] },
      { value: EmployeeIdType.PASSPORT, aliases: ['جواز سفر', 'جواز'] },
    ],
  },
  { key: 'nationalId', label: { en: 'National ID / Iqama', ar: 'الرقم القومي / الإقامة' } },
  { key: 'nationality', label: { en: 'Nationality (ISO)', ar: 'الجنسية (رمز)' }, example: 'EG' },
  { key: 'birthDate', label: { en: 'Birth date', ar: 'تاريخ الميلاد' }, type: 'date' },
  { key: 'gender', label: { en: 'Gender', ar: 'النوع' } },
  { key: 'email', label: { en: 'Email', ar: 'البريد الإلكتروني' } },
  { key: 'phone', label: { en: 'Phone', ar: 'الهاتف' } },
  { key: 'hireDate', label: { en: 'Hire date', ar: 'تاريخ التعيين' }, type: 'date', required: true },
  { key: 'branchCode', label: { en: 'Branch code', ar: 'كود الفرع' } },
  { key: 'departmentCode', label: { en: 'Department code or name', ar: 'كود أو اسم الإدارة' } },
  { key: 'jobTitleCode', label: { en: 'Job title code or name', ar: 'كود أو اسم الوظيفة' } },
  {
    key: 'contractType',
    label: { en: 'Contract type', ar: 'نوع العقد' },
    type: 'enum',
    values: [
      { value: ContractType.PERMANENT, aliases: ['دائم', 'غير محدد المدة'] },
      { value: ContractType.FIXED_TERM, aliases: ['محدد المدة', 'مؤقت المدة'] },
      { value: ContractType.PART_TIME, aliases: ['دوام جزئي'] },
      { value: ContractType.TEMPORARY, aliases: ['مؤقت'] },
    ],
  },
  { key: 'contractEndDate', label: { en: 'Contract end date', ar: 'تاريخ انتهاء العقد' }, type: 'date' },
  { key: 'basicSalary', label: { en: 'Basic salary', ar: 'الراتب الأساسي' }, type: 'number', min: 0, required: true },
  ...ALLOWANCES.map(
    (a): ColumnSpec => ({ key: a.key, label: { en: a.name, ar: a.ar }, type: 'number', min: 0 }),
  ),
  {
    key: 'socialInsuranceWage',
    label: { en: 'Insurable wage', ar: 'أجر الاشتراك التأميني' },
    type: 'number',
    min: 0,
  },
  { key: 'socialInsuranceNumber', label: { en: 'Social insurance number', ar: 'الرقم التأميني' } },
  {
    key: 'socialInsuranceEnrolled',
    label: { en: 'Insured', ar: 'مؤمن عليه' },
    type: 'boolean',
  },
  {
    key: 'payrollCountry',
    label: { en: 'Payroll country', ar: 'دولة الرواتب' },
    type: 'enum',
    values: [
      { value: PayrollCountry.EG, aliases: ['مصر', 'egypt'] },
      { value: PayrollCountry.SA, aliases: ['السعودية', 'saudi', 'ksa'] },
    ],
  },
  { key: 'bankName', label: { en: 'Bank', ar: 'البنك' } },
  { key: 'bankAccount', label: { en: 'Bank account', ar: 'رقم الحساب البنكي' } },
  { key: 'iban', label: { en: 'IBAN', ar: 'الآيبان' } },
  { key: 'trackAttendance', label: { en: 'Track attendance', ar: 'يخضع للحضور' }, type: 'boolean' },
];

const COPY = [
  'nameEn',
  'nameAr',
  'idType',
  'nationalId',
  'birthDate',
  'gender',
  'email',
  'phone',
  'hireDate',
  'contractType',
  'contractEndDate',
  'basicSalary',
  'socialInsuranceWage',
  'socialInsuranceNumber',
  'socialInsuranceEnrolled',
  'payrollCountry',
  'bankName',
  'bankAccount',
  'iban',
  'trackAttendance',
];

interface EmployeePlan {
  id?: string;
  dto: Record<string, any>;
}

/** Employees through the HR module's public EmployeesService (upsert by code). */
@Injectable()
export class EmployeesImporter implements Importer<EmployeePlan> {
  readonly entity = ImportEntity.EMPLOYEES;
  readonly title = { en: 'Employees', ar: 'الموظفون' };
  readonly columns = EMPLOYEE_COLUMNS;

  constructor(
    @InjectRepository(Branch) private readonly branchRepo: Repository<Branch>,
    @InjectRepository(Department) private readonly departmentRepo: Repository<Department>,
    @InjectRepository(JobTitle) private readonly jobTitleRepo: Repository<JobTitle>,
    private readonly employees: EmployeesService,
  ) {}

  async validate(ctx: ImportContext, rows: ParsedRow[]): Promise<ValidationOutcome<EmployeePlan>> {
    const { tenantId } = ctx;
    const issues = new IssueList();
    checkDuplicateCodes(rows, issues);
    const [employees, branches, departments, jobTitles] = await Promise.all([
      this.employees.findAll(tenantId),
      this.branchRepo.find({ where: { tenantId } }),
      this.departmentRepo.find({ where: { tenantId } }),
      this.jobTitleRepo.find({ where: { tenantId } }),
    ]);
    const byCode = new Map(employees.map((e) => [keyOf(e.code), e]));
    const lookup = <T extends { id: string }>(items: T[], names: (t: T) => (string | null | undefined)[]) => {
      const map = new Map<string, string>();
      for (const item of items) for (const n of names(item)) if (n && !map.has(keyOf(n))) map.set(keyOf(n), item.id);
      return map;
    };
    const branchMap = lookup(branches, (b) => [b.code, b.name]);
    const departmentMap = lookup(departments, (d) => [d.code, d.name, d.nameAr]);
    const jobMap = lookup(jobTitles, (j) => [j.code, j.name, j.nameAr]);
    const nationalIds = new Map<string, string>();
    for (const e of employees) if (e.nationalId) nationalIds.set(keyOf(e.nationalId), e.code);

    const planned: PlannedRow<EmployeePlan>[] = [];
    for (const row of rows) {
      const n = row.rowNumber;
      const code = has(row, 'code') ? String(v(row, 'code')) : undefined;
      const current = code ? byCode.get(keyOf(code)) : undefined;
      if (current && !ctx.options.updateExisting) {
        issues.warning(n, 'exists_skipped', `Employee ${code} already exists and is skipped`, 'code');
        planned.push({ row, action: 'skip', data: { dto: {} } });
        continue;
      }
      const dto: Record<string, any> = {};
      for (const key of COPY) if (has(row, key)) dto[key] = v(row, key);
      if (has(row, 'nationality')) {
        const nat = String(v(row, 'nationality')).toUpperCase();
        if (!/^[A-Z]{2}$/.test(nat)) issues.error(n, 'invalid_value', 'Nationality must be a 2-letter ISO code', 'nationality');
        dto.nationality = nat;
      }
      const ref = (column: string, map: Map<string, string>, field: string, what: string) => {
        if (!has(row, column)) return;
        const id = map.get(keyOf(v(row, column)));
        if (id) dto[field] = id;
        else issues.error(n, 'not_found', `${what} "${v(row, column)}" not found`, column);
      };
      ref('branchCode', branchMap, 'branchId', 'Branch');
      ref('departmentCode', departmentMap, 'departmentId', 'Department');
      ref('jobTitleCode', jobMap, 'jobTitleId', 'Job title');

      if (ALLOWANCES.some((a) => has(row, a.key))) {
        const kept = (current?.allowances ?? []).filter((x) => !ALLOWANCES.some((a) => a.code === x.code));
        dto.allowances = [
          ...kept,
          ...ALLOWANCES.filter((a) => has(row, a.key) && Number(v(row, a.key)) > 0).map((a) => ({
            code: a.code,
            name: a.name,
            amount: Number(v(row, a.key)),
          })),
        ];
      }
      if (dto.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dto.email)) {
        issues.error(n, 'invalid_email', `"${dto.email}" is not a valid email`, 'email');
      }
      const hire = dto.hireDate ?? current?.hireDate;
      if (dto.contractEndDate && hire && dto.contractEndDate < hire) {
        issues.error(n, 'invalid_date', 'Contract end date is before the hire date', 'contractEndDate');
      }
      if (dto.birthDate && hire && dto.birthDate >= hire) {
        issues.error(n, 'invalid_date', 'Birth date must be before the hire date', 'birthDate');
      }
      if (dto.nationalId) {
        const owner = nationalIds.get(keyOf(dto.nationalId));
        if (owner && (!code || keyOf(owner) !== keyOf(code))) {
          issues.warning(n, 'national_id_used', `National ID is also used by employee ${owner}`, 'nationalId');
        }
        nationalIds.set(keyOf(dto.nationalId), code ?? `row ${n}`);
      }
      if (dto.payrollCountry === PayrollCountry.SA && dto.idType === undefined && dto.nationality && dto.nationality !== 'SA') {
        dto.idType = EmployeeIdType.IQAMA;
      }
      if (current) {
        planned.push({ row, action: 'update', data: { id: current.id, dto } });
      } else {
        planned.push({ row, action: 'create', data: { dto: { ...dto, code } } });
      }
    }
    return { planned, issues: issues.items };
  }

  async commit(ctx: ImportContext, outcome: ValidationOutcome<EmployeePlan>): Promise<Record<string, unknown>> {
    let created = 0;
    let updated = 0;
    for (const item of outcome.planned) {
      if (item.action === 'create') {
        await this.employees.create(ctx.tenantId, item.data.dto as any);
        created++;
      } else if (item.action === 'update') {
        await this.employees.update(ctx.tenantId, item.data.id!, item.data.dto as any);
        updated++;
      }
    }
    return { created, updated };
  }

  async exportRows(tenantId: string): Promise<Record<string, unknown>[]> {
    const [employees, branches, departments, jobTitles] = await Promise.all([
      this.employees.findAll(tenantId),
      this.branchRepo.find({ where: { tenantId } }),
      this.departmentRepo.find({ where: { tenantId } }),
      this.jobTitleRepo.find({ where: { tenantId } }),
    ]);
    const code = <T extends { id: string; code: string }>(items: T[]) => new Map(items.map((i) => [i.id, i.code]));
    const [b, d, j] = [code(branches), code(departments), code(jobTitles)];
    return employees.map((e) => {
      const row: Record<string, unknown> = { code: e.code, nationality: e.nationality };
      for (const key of COPY) row[key] = (e as any)[key];
      row.basicSalary = Number(e.basicSalary);
      row.socialInsuranceWage = e.socialInsuranceWage === null ? null : Number(e.socialInsuranceWage);
      row.branchCode = e.branchId ? b.get(e.branchId) : null;
      row.departmentCode = e.departmentId ? d.get(e.departmentId) : null;
      row.jobTitleCode = e.jobTitleId ? j.get(e.jobTitleId) : null;
      for (const a of ALLOWANCES) {
        const found = (e.allowances ?? []).find((x) => x.code === a.code);
        row[a.key] = found ? Number(found.amount) : null;
      }
      return row;
    });
  }
}
