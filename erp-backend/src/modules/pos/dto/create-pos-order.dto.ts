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
  IsBoolean,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PosPaymentMethod } from '../entities/pos-order.entity';

export class PosOrderLineDto {
  @ApiProperty()
  @IsUUID()
  productId: string;

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

  @ApiPropertyOptional({ default: true, description: 'Apply active promotions (campaigns, bonus, invoice discount)' })
  @IsOptional()
  @IsBoolean()
  applyPromotions?: boolean;

  @ApiPropertyOptional({ description: 'Manual invoice discount (amount); replaces any automatic invoice discount' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  invoiceDiscount?: number;

  @ApiProperty({ type: [PosOrderLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PosOrderLineDto)
  lines: PosOrderLineDto[];
}
