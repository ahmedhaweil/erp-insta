import {
  IsUUID,
  IsEnum,
  IsNumber,
  IsOptional,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { LotInputDto } from '@modules/inventory/dto/lot-input.dto';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PosPaymentMethod } from '../entities/pos-order.entity';

export class PosOrderLineDto {
  @ApiPropertyOptional({ description: 'Product (or give a barcode instead)' })
  @ValidateIf((l) => !l.barcode)
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({
    description:
      'Scanned barcode: product barcode, alternate-unit barcode or product code; sets the product, unit and default price',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  barcode?: string;

  @ApiPropertyOptional({ description: 'Alternate unit (quantity and price in this unit); set by the barcode when scanned' })
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @ApiPropertyOptional({ type: [LotInputDto], description: 'Lots/serial numbers sold, in base units (FEFO when omitted)' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LotInputDto)
  lots?: LotInputDto[];

  @ApiProperty()
  @IsNumber()
  quantity: number;

  @ApiPropertyOptional({ description: 'Defaults to the product sale price' })
  @IsOptional()
  @IsNumber()
  unitPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  discount?: number;

  @ApiPropertyOptional({ description: 'Defaults to the product sales tax rate' })
  @IsOptional()
  @IsNumber()
  taxRate?: number;
}

export class CreatePosOrderDto {
  @ApiProperty()
  @IsUUID()
  sessionId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ description: 'Till-generated id; resending the same sale is idempotent' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  clientReference?: string;

  @ApiPropertyOptional({ description: "Sales rep credited with the sale; defaults to the customer's rep, else the cashier's rep" })
  @IsOptional()
  @IsUUID()
  salesRepId?: string;

  @ApiProperty({ enum: PosPaymentMethod })
  @IsEnum(PosPaymentMethod)
  paymentMethod: PosPaymentMethod;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  cashReceived?: number;

  @ApiPropertyOptional({ description: 'Cash part of a split payment (rest is card)' })
  @IsOptional()
  @IsNumber()
  cashAmount?: number;

  @ApiProperty({ type: [PosOrderLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PosOrderLineDto)
  lines: PosOrderLineDto[];
}
