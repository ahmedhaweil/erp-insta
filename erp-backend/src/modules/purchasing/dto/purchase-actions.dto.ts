import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PurchaseLineQuantityDto {
  @ApiProperty() @IsUUID() lineId: string;
  @ApiProperty() @IsNumber() @Min(0) quantity: number;
}

export class ReceiveOrderDto {
  @ApiPropertyOptional({ description: 'Defaults to the order warehouse' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ description: 'Partial receipt; defaults to all remaining quantities' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseLineQuantityDto)
  lines?: PurchaseLineQuantityDto[];
}

export class CreateBillFromOrderDto {
  @ApiPropertyOptional() @IsOptional() @IsString() date?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() supplierReference?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() post?: boolean;
}

export class RefundLineDto {
  @ApiProperty() @IsUUID() invoiceLineId: string;
  @ApiProperty() @IsNumber() @Min(0) quantity: number;
}

export class CreateVendorRefundDto {
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() date?: string;

  @ApiPropertyOptional({ description: 'Partial refund lines; defaults to the full bill' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RefundLineDto)
  lines?: RefundLineDto[];

  @ApiPropertyOptional() @IsOptional() @IsBoolean() post?: boolean;
}

export class GenerateReplenishmentDto {
  @ApiPropertyOptional({ description: 'Warehouse the RFQs receive into' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ description: 'Restrict to these products' })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  productIds?: string[];
}
