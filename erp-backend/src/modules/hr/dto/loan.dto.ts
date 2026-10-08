import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { HrPaymentMethod, LoanStatus, LoanType } from '../entities/employee-loan.entity';

export const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export class CreateLoanDto {
  @ApiProperty() @IsUUID() employeeId: string;

  @ApiPropertyOptional({ enum: LoanType, default: LoanType.LOAN })
  @IsOptional()
  @IsEnum(LoanType)
  type?: LoanType;

  @ApiProperty() @IsNumber() @Min(0.01) amount: number;

  @ApiProperty({ description: 'Number of monthly installments' })
  @IsInt()
  @Min(1)
  @Max(120)
  installmentCount: number;

  @ApiProperty({ example: '2026-11', description: 'First payroll month deducting an installment' })
  @Matches(PERIOD_PATTERN, { message: 'startPeriod must be YYYY-MM' })
  startPeriod: string;

  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class DisburseLoanDto {
  @ApiProperty() @IsDateString() date: string;

  @ApiProperty({ enum: HrPaymentMethod })
  @IsEnum(HrPaymentMethod)
  paymentMethod: HrPaymentMethod;
}

export class LoanQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() employeeId?: string;
  @ApiPropertyOptional({ enum: LoanStatus }) @IsOptional() @IsEnum(LoanStatus) status?: LoanStatus;
}
