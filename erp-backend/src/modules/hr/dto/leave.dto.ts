import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { LeaveRequestStatus } from '../entities/leave-request.entity';
import { PERIOD_PATTERN } from './loan.dto';

export class CreateLeaveTypeDto {
  @ApiProperty({ example: 'annual' }) @IsString() code: string;
  @ApiProperty() @IsString() name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() nameAr?: string;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isPaid?: boolean;

  @ApiPropertyOptional({ default: 0, description: 'Days per year; 0 = no balance' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  annualEntitlement?: number;

  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) seniorEntitlement?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) seniorAfterYears?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowNegative?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;

  @ApiPropertyOptional({ enum: ['annual', 'monthly'], default: 'annual' })
  @IsOptional()
  @IsIn(['annual', 'monthly'])
  accrualMethod?: 'annual' | 'monthly';

  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() carryForward?: boolean;

  @ApiPropertyOptional({ description: 'Max days carried into the next year (empty = unlimited)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  carryForwardMax?: number;

  @ApiPropertyOptional({ description: 'Carried days expire after N months of the new year' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  carryForwardExpiryMonths?: number;

  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() allowHalfDay?: boolean;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() encashable?: boolean;
}
export class UpdateLeaveTypeDto extends PartialType(CreateLeaveTypeDto) {}

export class CreateLeaveRequestDto {
  @ApiProperty() @IsUUID() employeeId: string;
  @ApiProperty() @IsUUID() leaveTypeId: string;
  @ApiProperty() @IsDateString() startDate: string;
  @ApiProperty() @IsDateString() endDate: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;

  @ApiPropertyOptional({ description: 'Half-day leave (startDate must equal endDate)' })
  @IsOptional()
  @IsBoolean()
  halfDay?: boolean;

  @ApiPropertyOptional({ enum: ['am', 'pm'] })
  @IsOptional()
  @IsIn(['am', 'pm'])
  halfDayPeriod?: 'am' | 'pm';
}

/** Self-service: the employee is the one linked to the current user. */
export class MyLeaveRequestDto extends OmitType(CreateLeaveRequestDto, ['employeeId'] as const) {}

export class DecideLeaveDto {
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
}

export class LeaveRequestQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() employeeId?: string;
  @ApiPropertyOptional({ enum: LeaveRequestStatus })
  @IsOptional()
  @IsEnum(LeaveRequestStatus)
  status?: LeaveRequestStatus;
}

export class CreateLeaveEncashmentDto {
  @ApiProperty() @IsUUID() employeeId: string;
  @ApiProperty() @IsUUID() leaveTypeId: string;
  @ApiProperty({ description: 'Leave year whose balance is encashed' }) @IsInt() year: number;
  @ApiProperty() @IsNumber() @Min(0.5) days: number;

  @ApiProperty({ example: '2026-12', description: 'Payroll month paying the encashment' })
  @Matches(PERIOD_PATTERN, { message: 'period must be YYYY-MM' })
  period: string;

  @ApiPropertyOptional({ description: 'Defaults to (basic + allowances) / general.daysPerMonth' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  dailyRate?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class LeaveEncashmentQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() employeeId?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(PERIOD_PATTERN) period?: string;
}
