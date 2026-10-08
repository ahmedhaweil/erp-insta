import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LotInputDto } from './lot-input.dto';

/** Manual goods receipt (opening stock, found goods) with explicit lots. */
export class StockReceiptDto {
  @ApiProperty()
  @IsUUID()
  productId: string;

  @ApiProperty()
  @IsUUID()
  warehouseId: string;

  @ApiProperty({ description: 'Quantity in base unit' })
  @IsNumber()
  @Min(0.0001)
  quantity: number;

  @ApiPropertyOptional({ description: 'Unit cost (default: current average cost)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitCost?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({ type: [LotInputDto], description: 'Required for lot/serial-tracked products' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LotInputDto)
  lots?: LotInputDto[];
}

export class InventorySettingsDto {
  @ApiPropertyOptional({ description: 'Allow on-hand stock to go below zero (default false)' })
  @IsOptional()
  @IsBoolean()
  allowNegativeStock?: boolean;

  @ApiPropertyOptional({ description: 'Default horizon (days) of the expiring-lots report' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  expiryAlertDays?: number;
}
