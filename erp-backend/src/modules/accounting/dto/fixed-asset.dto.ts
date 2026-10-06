import {
  IsString,
  IsOptional,
  IsUUID,
  IsNumber,
  IsIn,
  IsInt,
  Min,
  IsDateString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateFixedAssetDto {
  @ApiProperty() @IsString() code: string;
  @ApiProperty() @IsString() name: string;
  @ApiProperty() @IsDateString() purchaseDate: string;
  @ApiProperty() @IsNumber() @Min(0) purchaseValue: number;
  @ApiProperty() @IsInt() @Min(1) usefulLifeMonths: number;

  @ApiPropertyOptional({ enum: ['straight_line', 'declining_balance'] })
  @IsOptional()
  @IsIn(['straight_line', 'declining_balance'])
  depreciationMethod?: string;

  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) salvageValue?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) decliningRate?: number;
  @ApiPropertyOptional({ description: 'Asset (cost) account' })
  @IsOptional()
  @IsUUID()
  accountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() depreciationExpenseAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() accumulatedDepreciationAccountId?: string;
}

export class RunDepreciationDto {
  @ApiPropertyOptional({ description: 'Post depreciation up to this date (default: today)' })
  @IsOptional()
  @IsDateString()
  asOf?: string;
}

export class DisposeAssetDto {
  @ApiProperty() @IsDateString() date: string;

  @ApiPropertyOptional({ description: 'Sale proceeds; 0 for a write-off' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  saleAmount?: number;
}

export class CreateFiscalYearDto {
  @ApiProperty() @IsString() name: string;
  @ApiProperty() @IsDateString() startDate: string;
  @ApiProperty() @IsDateString() endDate: string;
}

export class CreateBudgetDto {
  @ApiProperty() @IsUUID() fiscalYearId: string;
  @ApiProperty() @IsUUID() accountId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() costCenterId?: string;

  @ApiPropertyOptional({ enum: ['monthly', 'quarterly', 'annual'] })
  @IsOptional()
  @IsIn(['monthly', 'quarterly', 'annual'])
  period?: 'monthly' | 'quarterly' | 'annual';

  @ApiProperty({ description: 'Planned amount per period' })
  @IsNumber()
  amount: number;
}
