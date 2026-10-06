import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';

export class OrderLineQuantityDto {
  @ApiProperty() @IsUUID() lineId: string;
  @ApiProperty() @IsNumber() @Min(0) quantity: number;
}

export class DeliverOrderDto {
  @ApiPropertyOptional({ description: 'Defaults to the order warehouse' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ description: 'Partial delivery; defaults to all remaining quantities' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderLineQuantityDto)
  lines?: OrderLineQuantityDto[];

  @ApiPropertyOptional() @IsOptional() @IsString() date?: string;
}

export class CreateInvoiceFromOrderDto {
  @ApiPropertyOptional({
    enum: ['ordered', 'delivered'],
    description: 'Invoice ordered quantities or delivered quantities (Odoo invoicing policy)',
  })
  @IsOptional()
  @IsIn(['ordered', 'delivered'])
  policy?: 'ordered' | 'delivered';

  @ApiPropertyOptional() @IsOptional() @IsString() date?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() post?: boolean;
}

export class CreditNoteLineDto {
  @ApiProperty() @IsUUID() invoiceLineId: string;
  @ApiProperty() @IsNumber() @Min(0) quantity: number;
}

export class CreateCreditNoteDto {
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() date?: string;

  @ApiPropertyOptional({ description: 'Partial refund lines; defaults to the full invoice' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreditNoteLineDto)
  lines?: CreditNoteLineDto[];

  @ApiPropertyOptional() @IsOptional() @IsBoolean() post?: boolean;
}
