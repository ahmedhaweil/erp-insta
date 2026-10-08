import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
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
import { ReturnRefundMethod } from '../entities/sales-return.entity';

export class ReturnLineDto {
  @ApiPropertyOptional({ description: 'Original invoice line (required when returning against an invoice)' })
  @IsOptional()
  @IsUUID()
  invoiceLineId?: string;

  @ApiPropertyOptional({ description: 'Required for returns without an original document' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiProperty()
  @IsNumber()
  @Min(0.0001)
  quantity: number;

  @ApiPropertyOptional({ description: 'Required for returns without an original document' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @ApiPropertyOptional({ description: 'Absolute discount (returns without an original document)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  taxRate?: number;

  @ApiPropertyOptional({
    description:
      'Move the goods in stock: back in for sales returns, out for purchase returns (default true)',
  })
  @IsOptional()
  @IsBoolean()
  restock?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
}

export class ReturnHeaderDto {
  @ApiPropertyOptional({ description: 'Warehouse the goods return to / leave from' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() date?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;

  @ApiPropertyOptional({ enum: ReturnRefundMethod, description: 'credit (default) or cash refund' })
  @IsOptional()
  @IsEnum(ReturnRefundMethod)
  refundMethod?: ReturnRefundMethod;

  @ApiPropertyOptional({ description: 'Prices include VAT (returns without an original document)' })
  @IsOptional()
  @IsBoolean()
  pricesIncludeTax?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsUUID() currencyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() exchangeRate?: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;

  @ApiPropertyOptional({ description: 'Validate immediately (stock + credit note / refund)' })
  @IsOptional()
  @IsBoolean()
  post?: boolean;

  @ApiProperty({ type: [ReturnLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReturnLineDto)
  lines: ReturnLineDto[];
}

export class CreateSalesReturnDto extends ReturnHeaderDto {
  @ApiPropertyOptional({ description: 'Required for returns without an original invoice' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ description: 'Posted invoice the goods were sold on' })
  @IsOptional()
  @IsUUID()
  originalInvoiceId?: string;
}
