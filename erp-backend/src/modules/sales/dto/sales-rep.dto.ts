import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { CommissionBasis } from '../entities/commission-rule.entity';

export class CreateSalesRepDto {
  @ApiProperty() @IsString() code: string;
  @ApiProperty() @IsString() name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;

  @ApiPropertyOptional({ description: 'Linked system user' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ description: 'Linked HR employee' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateSalesRepDto extends PartialType(CreateSalesRepDto) {}

export class CreateCommissionRuleDto {
  @ApiProperty() @IsString() name: string;

  @ApiPropertyOptional({ description: 'Empty = applies to every rep' })
  @IsOptional()
  @IsUUID()
  salesRepId?: string;

  @ApiPropertyOptional({ description: 'Empty = every product category' })
  @IsOptional()
  @IsUUID()
  productCategoryId?: string;

  @ApiPropertyOptional({ enum: CommissionBasis, default: CommissionBasis.COLLECTED })
  @IsOptional()
  @IsEnum(CommissionBasis)
  basis?: CommissionBasis;

  @ApiProperty({ description: 'Commission rate (%)' })
  @IsNumber()
  @Min(0)
  @Max(100)
  rate: number;

  @ApiPropertyOptional({ description: 'Period target the rep must reach for this tier', default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  targetAmount?: number;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateCommissionRuleDto extends PartialType(CreateCommissionRuleDto) {}

export class CommissionPeriodDto {
  @ApiProperty() @IsUUID() salesRepId: string;
  @ApiProperty({ example: '2026-01-01' }) @IsString() periodFrom: string;
  @ApiProperty({ example: '2026-01-31' }) @IsString() periodTo: string;
}

export class PostCommissionDto {
  @ApiPropertyOptional({ description: 'Accrual date (default period end)' })
  @IsOptional()
  @IsString()
  date?: string;
}
