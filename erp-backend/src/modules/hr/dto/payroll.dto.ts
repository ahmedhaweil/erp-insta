import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AdjustmentKind } from '../entities/payroll-adjustment.entity';
import { HrPaymentMethod } from '../entities/employee-loan.entity';
import { PayrollRunStatus } from '../entities/payroll-run.entity';
import { PERIOD_PATTERN } from './loan.dto';

export class CreatePayrollRunDto {
  @ApiProperty({ example: '2026-10' })
  @Matches(PERIOD_PATTERN, { message: 'period must be YYYY-MM' })
  period: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class ApprovePayrollRunDto {
  @ApiPropertyOptional({ description: 'Accounting date; defaults to the last day of the period' })
  @IsOptional()
  @IsDateString()
  postingDate?: string;
}

export class PayPayrollRunDto {
  @ApiProperty() @IsDateString() date: string;

  @ApiProperty({ enum: HrPaymentMethod })
  @IsEnum(HrPaymentMethod)
  paymentMethod: HrPaymentMethod;
}

export class ReversePayrollRunDto {
  @ApiPropertyOptional({ description: 'Date of the reversal entries; defaults to the original dates' })
  @IsOptional()
  @IsDateString()
  date?: string;
}

export class CreatePayrollAdjustmentDto {
  @ApiProperty() @IsUUID() employeeId: string;

  @ApiProperty({ example: '2026-10' })
  @Matches(PERIOD_PATTERN, { message: 'period must be YYYY-MM' })
  period: string;

  @ApiProperty({ enum: AdjustmentKind }) @IsEnum(AdjustmentKind) kind: AdjustmentKind;

  @ApiPropertyOptional({ example: 'bonus', description: 'bonus, commission, penalty, other...' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiProperty() @IsString() description: string;
  @ApiProperty() @IsNumber() @Min(0.01) amount: number;

  @ApiPropertyOptional({ default: true, description: 'Egypt: addition subject to salary tax' })
  @IsOptional()
  @IsBoolean()
  taxable?: boolean;
}

export class PayrollAdjustmentQueryDto {
  @ApiPropertyOptional() @IsOptional() @Matches(PERIOD_PATTERN) period?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() employeeId?: string;
}

export class PayrollRunQueryDto {
  @ApiPropertyOptional() @IsOptional() @Matches(PERIOD_PATTERN) period?: string;
  @ApiPropertyOptional({ enum: PayrollRunStatus })
  @IsOptional()
  @IsEnum(PayrollRunStatus)
  status?: PayrollRunStatus;
}

export class PeriodQueryDto {
  @ApiProperty({ example: '2026-10' })
  @Matches(PERIOD_PATTERN, { message: 'period must be YYYY-MM' })
  period: string;
}
