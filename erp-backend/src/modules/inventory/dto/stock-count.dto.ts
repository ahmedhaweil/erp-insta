import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateStockCountDto {
  @ApiProperty()
  @IsUUID()
  warehouseId: string;

  @ApiPropertyOptional({ description: 'Count only this category (and its sub-categories)' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ type: [String], description: 'Count only these products' })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  productIds?: string[];

  @ApiPropertyOptional({
    description: 'Also list active goods never stocked in this warehouse (default: only products with a stock record)',
  })
  @IsOptional()
  @IsBoolean()
  includeAllProducts?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class StockCountEntryDto {
  @ApiPropertyOptional({ description: 'Existing count line; otherwise matched by product (+ lot) or barcode' })
  @IsOptional()
  @IsUUID()
  lineId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ description: 'Scanned barcode (product or alternate unit barcode)' })
  @IsOptional()
  @IsString()
  barcode?: string;

  @ApiPropertyOptional({ description: 'Lot/serial number (tracked products)' })
  @IsOptional()
  @IsString()
  lotNumber?: string;

  @ApiPropertyOptional({ description: 'Expiry of a lot found that is not in the system' })
  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @ApiProperty({ description: 'Counted quantity (in `unitId`, or the scanned unit, else base unit)' })
  @IsNumber()
  @Min(0)
  countedQty: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @ApiPropertyOptional({ description: 'Add to the quantity already counted instead of replacing it' })
  @IsOptional()
  @IsBoolean()
  accumulate?: boolean;
}

export class UpdateStockCountLinesDto {
  @ApiProperty({ type: [StockCountEntryDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StockCountEntryDto)
  lines: StockCountEntryDto[];
}

export class ValidateStockCountDto {
  @ApiPropertyOptional({ description: 'Treat lines left uncounted as counted zero (default: skip them)' })
  @IsOptional()
  @IsBoolean()
  zeroUncounted?: boolean;
}
