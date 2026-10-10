import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LotInputDto } from './lot-input.dto';
import { StockIssueStatus, StockIssueType } from '../entities/stock-issue.entity';

export class StockIssueLineDto {
  @ApiProperty() @IsUUID() productId: string;

  @ApiProperty({ description: 'Quantity in `unitId` (base unit when omitted)' })
  @IsNumber()
  @Min(0.0001)
  quantity: number;

  @ApiPropertyOptional({ description: 'Alternate unit of the product' })
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @ApiPropertyOptional({ type: [LotInputDto], description: 'Lots/serials issued (FEFO when omitted), base unit' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LotInputDto)
  lots?: LotInputDto[];

  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class CreateStockIssueDto {
  @ApiProperty({ enum: StockIssueType })
  @IsEnum(StockIssueType)
  type: StockIssueType;

  @ApiProperty() @IsUUID() warehouseId: string;

  @ApiPropertyOptional({ description: 'Document date (default today)' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;

  @ApiPropertyOptional({ description: 'Donation beneficiary / sample recipient' })
  @IsOptional()
  @IsString()
  beneficiary?: string;

  @ApiPropertyOptional({ description: 'Expense account overriding the default of the type' })
  @IsOptional()
  @IsUUID()
  expenseAccountId?: string;

  @ApiProperty({ type: [StockIssueLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StockIssueLineDto)
  lines: StockIssueLineDto[];

  @ApiPropertyOptional({ description: 'Post immediately' })
  @IsOptional()
  @IsBoolean()
  post?: boolean;
}

export class StockIssueQueryDto {
  @ApiPropertyOptional({ enum: StockIssueType })
  @IsOptional()
  @IsEnum(StockIssueType)
  type?: StockIssueType;

  @ApiPropertyOptional({ enum: StockIssueStatus })
  @IsOptional()
  @IsEnum(StockIssueStatus)
  status?: StockIssueStatus;

  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
}
