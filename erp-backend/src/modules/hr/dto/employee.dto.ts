import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { ContractType, EmployeeIdType, EmployeeStatus, PayrollCountry } from '../entities/employee.entity';

export class AllowanceDto {
  @ApiProperty({ example: 'housing' }) @IsString() code: string;
  @ApiProperty({ example: 'Housing allowance' }) @IsString() name: string;
  @ApiProperty() @IsNumber() @Min(0) amount: number;
}

export class CreateEmployeeDto {
  @ApiPropertyOptional({ description: 'Generated (EMP-000001) when omitted' })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiProperty() @IsString() nameEn: string;
  @ApiPropertyOptional() @IsOptional() @IsString() nameAr?: string;

  @ApiPropertyOptional({ enum: EmployeeIdType })
  @IsOptional()
  @IsEnum(EmployeeIdType)
  idType?: EmployeeIdType;

  @ApiPropertyOptional({ description: 'National ID or iqama number' })
  @IsOptional()
  @IsString()
  nationalId?: string;

  @ApiPropertyOptional({ example: 'EG', description: 'ISO 3166-1 alpha-2' })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  nationality?: string;

  @ApiPropertyOptional() @IsOptional() @IsDateString() birthDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() gender?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiProperty() @IsDateString() hireDate: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() jobTitleId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() managerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() workScheduleId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() bankName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() bankAccount?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() iban?: string;

  @ApiPropertyOptional({ enum: ContractType })
  @IsOptional()
  @IsEnum(ContractType)
  contractType?: ContractType;

  @ApiPropertyOptional() @IsOptional() @IsDateString() contractEndDate?: string;

  @ApiProperty() @IsNumber() @Min(0) basicSalary: number;

  @ApiPropertyOptional({ type: [AllowanceDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AllowanceDto)
  allowances?: AllowanceDto[];

  @ApiPropertyOptional({ description: 'Contractual insurable wage; derived from the salary when omitted' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  socialInsuranceWage?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() socialInsuranceNumber?: string;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() socialInsuranceEnrolled?: boolean;

  @ApiPropertyOptional({ enum: PayrollCountry, default: PayrollCountry.EG })
  @IsOptional()
  @IsEnum(PayrollCountry)
  payrollCountry?: PayrollCountry;

  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() trackAttendance?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsUUID() userId?: string;
}

export class UpdateEmployeeDto extends PartialType(OmitType(CreateEmployeeDto, ['code'] as const)) {}

export class TerminateEmployeeDto {
  @ApiProperty() @IsDateString() terminationDate: string;
  @ApiProperty() @IsString() terminationReason: string;
}

export class EmployeeQueryDto {
  @ApiPropertyOptional({ enum: EmployeeStatus })
  @IsOptional()
  @IsEnum(EmployeeStatus)
  status?: EmployeeStatus;

  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() search?: string;
}

export class GratuityDto {
  @ApiPropertyOptional({ description: 'Takes country, wage and dates from the employee' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional({ enum: PayrollCountry })
  @IsOptional()
  @IsEnum(PayrollCountry)
  country?: PayrollCountry;

  @ApiPropertyOptional({ description: 'Last monthly wage; defaults to basic + allowances' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlyWage?: number;

  @ApiPropertyOptional() @IsOptional() @IsDateString() startDate?: string;
  @ApiPropertyOptional({ description: 'Defaults to the termination date or today' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiProperty({
    enum: ['termination', 'contract_end', 'resignation', 'resignation_article_87', 'dismissal_article_80'],
  })
  @IsEnum(['termination', 'contract_end', 'resignation', 'resignation_article_87', 'dismissal_article_80'])
  reason: 'termination' | 'contract_end' | 'resignation' | 'resignation_article_87' | 'dismissal_article_80';
}
