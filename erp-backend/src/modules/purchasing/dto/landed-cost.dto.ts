import {
  ArrayMinSize,
  IsArray,
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
import { LandedCostSplit } from '../entities/landed-cost.entity';

export class LandedCostChargeDto {
  @ApiProperty() @IsString() description: string;
  @ApiProperty() @IsNumber() @Min(0.01) amount: number;
  @ApiPropertyOptional({ description: 'Account credited; default: the purchase (expense) account' })
  @IsOptional()
  @IsUUID()
  accountId?: string;
}

export class CreateLandedCostDto {
  @ApiProperty() @IsDateString() date: string;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @IsUUID('4', { each: true }) purchaseOrderIds: string[];
  @ApiPropertyOptional({ enum: LandedCostSplit, default: LandedCostSplit.BY_VALUE })
  @IsOptional()
  @IsEnum(LandedCostSplit)
  splitMethod?: LandedCostSplit;
  @ApiProperty({ type: [LandedCostChargeDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LandedCostChargeDto)
  charges: LandedCostChargeDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}
