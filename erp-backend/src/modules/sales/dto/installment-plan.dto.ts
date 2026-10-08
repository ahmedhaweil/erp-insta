import { IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
}
