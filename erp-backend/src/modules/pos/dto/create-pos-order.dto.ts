import {
  IsUUID,
  IsEnum,
  IsNumber,
  IsOptional,
  IsArray,
  ValidateNested,
  ArrayMinSize,
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

  @ApiProperty()
  @IsNumber()
  unitPrice: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  discount?: number;

  @ApiPropertyOptional()
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

  @ApiProperty({ enum: PosPaymentMethod })
  @IsEnum(PosPaymentMethod)
  paymentMethod: PosPaymentMethod;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  cashReceived?: number;

  @ApiProperty({ type: [PosOrderLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PosOrderLineDto)
  lines: PosOrderLineDto[];
}
