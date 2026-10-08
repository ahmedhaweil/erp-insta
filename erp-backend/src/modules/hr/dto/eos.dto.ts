import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PERIOD_PATTERN } from './loan.dto';
import { HrPaymentMethod } from '../entities/employee-loan.entity';
import { FinalSettlementStatus } from '../entities/final-settlement.entity';

const REASONS = ['termination', 'contract_end', 'resignation', 'resignation_article_87', 'dismissal_article_80'];

export class CreateEosProvisionDto {
  @ApiProperty({ example: '2026-10' })
  @Matches(PERIOD_PATTERN, { message: 'period must be YYYY-MM' })
  period: string;

  @ApiPropertyOptional({ description: 'Accounting date; defaults to the last day of the period' })
  @IsOptional()
  @IsDateString()
  postingDate?: string;
}

export class SettlementItemDto {
  @ApiProperty() @IsString() description: string;
  @ApiProperty() @IsNumber() @Min(0.01) amount: number;
}

export class CreateFinalSettlementDto {
  @ApiProperty({ description: 'A terminated employee' }) @IsUUID() employeeId: string;

  @ApiProperty({ enum: REASONS })
  @IsIn(REASONS)
  reason: 'termination' | 'contract_end' | 'resignation' | 'resignation_article_87' | 'dismissal_article_80';

  @ApiPropertyOptional({
    description:
      'Salary of the last (unpaid) month; computed pro rata when omitted and the month is not in an approved payroll',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  lastSalary?: number;

  @ApiPropertyOptional({ default: true, description: 'Encash the remaining balance of encashable leave types' })
  @IsOptional()
  @IsBoolean()
  encashLeave?: boolean;

  @ApiPropertyOptional({ type: [SettlementItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SettlementItemDto)
  additions?: SettlementItemDto[];

  @ApiPropertyOptional({ type: [SettlementItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SettlementItemDto)
  deductions?: SettlementItemDto[];

  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class PostFinalSettlementDto {
  @ApiPropertyOptional({ description: 'Accounting date; defaults to the termination date' })
  @IsOptional()
  @IsDateString()
  date?: string;
}

export class PayFinalSettlementDto {
  @ApiProperty() @IsDateString() date: string;
  @ApiProperty({ enum: HrPaymentMethod }) @IsEnum(HrPaymentMethod) paymentMethod: HrPaymentMethod;
}

export class CancelFinalSettlementDto {
  @ApiPropertyOptional({ description: 'Date of the reversal entries' })
  @IsOptional()
  @IsDateString()
  date?: string;
}

export class FinalSettlementQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() employeeId?: string;
  @ApiPropertyOptional({ enum: FinalSettlementStatus })
  @IsOptional()
  @IsEnum(FinalSettlementStatus)
  status?: FinalSettlementStatus;
}
