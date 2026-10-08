import { Entity, Column, Unique, Index } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

export enum PayrollCountry {
  EG = 'EG',
  SA = 'SA',
}

export enum EmployeeIdType {
  NATIONAL_ID = 'national_id',
  IQAMA = 'iqama',
  PASSPORT = 'passport',
}

export enum ContractType {
  PERMANENT = 'permanent',
  FIXED_TERM = 'fixed_term',
  PART_TIME = 'part_time',
  TEMPORARY = 'temporary',
}

export enum EmployeeStatus {
  ACTIVE = 'active',
  TERMINATED = 'terminated',
}

export interface EmployeeAllowance {
  /** Machine code, e.g. housing, transport, other (housing is part of the GOSI wage). */
  code: string;
  name: string;
  amount: number;
}

@Entity('hr_employees')
@Unique(['tenantId', 'code'])
export class Employee extends TenantBaseEntity {
  @Column()
  code: string;

  @Column({ name: 'name_en' })
  nameEn: string;

  @Column({ name: 'name_ar', nullable: true })
  nameAr: string;

  @Column({
    name: 'id_type',
    type: 'enum',
    enum: EmployeeIdType,
    default: EmployeeIdType.NATIONAL_ID,
  })
  idType: EmployeeIdType;

  /** National ID (Egypt / Saudi) or iqama number for residents. */
  @Column({ name: 'national_id', nullable: true })
  nationalId: string;

  /** ISO 3166-1 alpha-2 nationality (EG, SA, ...). */
  @Column({ length: 2, default: 'EG' })
  nationality: string;

  @Column({ type: 'date', name: 'birth_date', nullable: true })
  birthDate: string | null;

  @Column({ nullable: true })
  gender: string;

  @Column({ nullable: true })
  email: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ name: 'hire_date', type: 'date' })
  hireDate: string;

  @Index()
  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string | null;

  @Index()
  @Column({ name: 'department_id', type: 'uuid', nullable: true })
  departmentId: string | null;

  @Column({ name: 'job_title_id', type: 'uuid', nullable: true })
  jobTitleId: string | null;

  @Column({ name: 'manager_id', type: 'uuid', nullable: true })
  managerId: string | null;

  @Column({ name: 'work_schedule_id', type: 'uuid', nullable: true })
  workScheduleId: string | null;

  @Column({ name: 'bank_name', nullable: true })
  bankName: string;

  @Column({ name: 'bank_account', nullable: true })
  bankAccount: string;

  @Column({ nullable: true })
  iban: string;

  @Column({
    name: 'contract_type',
    type: 'enum',
    enum: ContractType,
    default: ContractType.PERMANENT,
  })
  contractType: ContractType;

  @Column({ name: 'contract_end_date', type: 'date', nullable: true })
  contractEndDate: string | null;

  @Column({ type: 'enum', enum: EmployeeStatus, default: EmployeeStatus.ACTIVE })
  status: EmployeeStatus;

  @Column({ name: 'termination_date', type: 'date', nullable: true })
  terminationDate: string | null;

  @Column({ name: 'termination_reason', type: 'varchar', nullable: true })
  terminationReason: string | null;

  @Column({ name: 'basic_salary', type: 'decimal', precision: 18, scale: 4, default: 0 })
  basicSalary: number;

  /** Fixed monthly allowances (housing, transport, other named components). */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  allowances: EmployeeAllowance[];

  /**
   * Contractual insurable wage (Egypt: أجر الاشتراك, Saudi: GOSI wage). When
   * null it is derived from the salary (EG: basic + allowances, SA: basic + housing).
   */
  @Column({
    name: 'social_insurance_wage',
    type: 'decimal',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  socialInsuranceWage: number | null;

  @Column({ name: 'social_insurance_number', nullable: true })
  socialInsuranceNumber: string;

  @Column({ name: 'social_insurance_enrolled', default: true })
  socialInsuranceEnrolled: boolean;

  @Column({
    name: 'payroll_country',
    type: 'enum',
    enum: PayrollCountry,
    default: PayrollCountry.EG,
  })
  payrollCountry: PayrollCountry;

  /** When true, absence, lateness and overtime come from attendance records. */
  @Column({ name: 'track_attendance', default: false })
  trackAttendance: boolean;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  /** Cost center charged with the employee's payroll and end-of-service costs. */
  @Column({ name: 'cost_center_id', type: 'uuid', nullable: true })
  costCenterId: string | null;
}
