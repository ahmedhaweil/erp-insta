import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { InstallmentFrequency, InstallmentStatus } from '../entities/installment-plan.entity';

export class CreateInstallmentPlanDto {
  @ApiProperty({ description: 'Posted sales invoice sold on installments' })
  @IsUUID()
  invoiceId: string;

  @ApiPropertyOptional({ description: 'Plan date / down payment due date (default today)' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'First installment due date (default start + 1 period)' })
  @IsOptional()
  @IsString()
  firstDueDate?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  downPayment?: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(360)
  numberOfInstallments: number;

  @ApiPropertyOptional({ enum: InstallmentFrequency, default: InstallmentFrequency.MONTHLY })
  @IsOptional()
  @IsEnum(InstallmentFrequency)
  frequency?: InstallmentFrequency;

  @ApiPropertyOptional({
    description: 'Simple financing rate (%) on the financed amount (residual - down payment)',
    default: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  interestRate?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;

  @ApiPropertyOptional({ type: () => InstallmentGuarantorDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => InstallmentGuarantorDto)
  guarantor?: InstallmentGuarantorDto;
}

export class InstallmentGuarantorDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() nationalId?: string;
  @ApiPropertyOptional({ description: 'Guarantor who is also a customer' })
  @IsOptional()
  @IsUUID()
  customerId?: string;
}

/**
 * Reschedules the unpaid balance of a plan: give either a new installment
 * amount (the count follows) or a new number of installments.
 */
export class RescheduleInstallmentPlanDto {
  @ApiPropertyOptional({ description: 'New installment amount (the last one takes the remainder)' })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  installmentAmount?: number;

  @ApiPropertyOptional({ description: 'New number of installments for the remaining balance' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(360)
  numberOfInstallments?: number;

  @ApiPropertyOptional({
    description: 'Due date of the first new installment (default: first unpaid due date)',
  })
  @IsOptional()
  @IsString()
  firstDueDate?: string;

  @ApiPropertyOptional({ enum: InstallmentFrequency })
  @IsOptional()
  @IsEnum(InstallmentFrequency)
  frequency?: InstallmentFrequency;

  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class InstallmentReportQueryDto {
  @ApiPropertyOptional({ description: 'Report date (default today)' })
  @IsOptional()
  @IsString()
  asOf?: string;

  @ApiPropertyOptional({ description: 'Only installments due on or before this date' })
  @IsOptional()
  @IsString()
  dueTo?: string;

  @ApiPropertyOptional({ enum: InstallmentStatus })
  @IsOptional()
  @IsEnum(InstallmentStatus)
  status?: InstallmentStatus;

  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;

  @ApiPropertyOptional({
    description:
      'Collection list: overdue installments plus those due within N days of asOf (e.g. 7)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  upcomingDays?: number;
}
