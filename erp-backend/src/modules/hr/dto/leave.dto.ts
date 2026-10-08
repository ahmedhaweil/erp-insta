import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { LeaveRequestStatus } from '../entities/leave-request.entity';

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
}
export class UpdateLeaveTypeDto extends PartialType(CreateLeaveTypeDto) {}

export class CreateLeaveRequestDto {
  @ApiProperty() @IsUUID() employeeId: string;
  @ApiProperty() @IsUUID() leaveTypeId: string;
  @ApiProperty() @IsDateString() startDate: string;
  @ApiProperty() @IsDateString() endDate: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
}

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
