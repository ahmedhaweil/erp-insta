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
import { LotInputDto } from './lot-input.dto';

export class StockTransferLineDto {
  @ApiProperty()
  @IsUUID()
  productId: string;

  @ApiProperty({ description: 'Quantity in `unitId` (base unit when omitted)' })
  @IsNumber()
  @Min(0.0001)
  quantity: number;

  @ApiPropertyOptional({ description: 'Alternate unit of the product (converted to base unit)' })
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @ApiPropertyOptional({ type: [LotInputDto], description: 'Lots/serials to ship (FEFO when omitted), base unit' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LotInputDto)
  lots?: LotInputDto[];
}

export class CreateStockTransferDto {
  @ApiProperty()
  @IsUUID()
  fromWarehouseId: string;

  @ApiProperty()
  @IsUUID()
  toWarehouseId: string;

  @ApiPropertyOptional({ description: 'Document date (default today)' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: 'One-step transfer: ship and receive immediately' })
  @IsOptional()
  @IsBoolean()
  direct?: boolean;

  @ApiProperty({ type: [StockTransferLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StockTransferLineDto)
  lines: StockTransferLineDto[];
}

export class ReceiveTransferLineDto {
  @ApiProperty()
  @IsUUID()
  lineId: string;

  @ApiProperty({ description: 'Quantity received now (base unit)' })
  @IsNumber()
  @Min(0)
  quantity: number;

  @ApiPropertyOptional({ type: [LotInputDto], description: 'Shipped lots received (FEFO when omitted)' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LotInputDto)
  lots?: LotInputDto[];
}

export class ReceiveStockTransferDto {
  @ApiPropertyOptional({ description: 'Receipt date for the inter-branch entry (default today)' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({
    type: [ReceiveTransferLineDto],
    description: 'Partial receipt; everything outstanding is received when omitted',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiveTransferLineDto)
  lines?: ReceiveTransferLineDto[];
}
