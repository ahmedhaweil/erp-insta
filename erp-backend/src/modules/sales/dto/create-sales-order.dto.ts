import {
  IsString,
  IsOptional,
  IsUUID,
  IsNumber,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  IsBoolean,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSalesOrderLineDto {
  @ApiProperty()
  @IsUUID()
  productId: string;

  @ApiProperty()
  @IsNumber()
  quantity: number;

  @ApiPropertyOptional({
    description: 'Omit to price the line from the customer price list (or product sales price)',
  })
  @IsOptional()
  @IsNumber()
  unitPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  discount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  taxRate?: number;

  @ApiPropertyOptional({ description: 'Ignored: recomputed server-side' })
  @IsOptional()
  @IsNumber()
  lineTotal?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}

export class CreateSalesOrderDto {
  @ApiProperty()
  @IsUUID()
  customerId: string;

  @ApiProperty()
  @IsString()
  date: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  currencyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  exchangeRate?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ description: 'Warehouse to reserve and deliver from' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ description: 'Quotation expiry date' })
  @IsOptional()
  @IsString()
  validityDate?: string;

  @ApiPropertyOptional({ description: 'Sales representative; defaults to the customer rep' })
  @IsOptional()
  @IsUUID()
  salesRepId?: string;

  @ApiPropertyOptional({ description: 'Price list; defaults to the customer / customer category list' })
  @IsOptional()
  @IsUUID()
  priceListId?: string;

  @ApiPropertyOptional({ description: 'Unit prices include VAT' })
  @IsOptional()
  @IsBoolean()
  pricesIncludeTax?: boolean;

  @ApiPropertyOptional({ default: true, description: 'Apply active promotions (campaigns, bonus, invoice discount)' })
  @IsOptional()
  @IsBoolean()
  applyPromotions?: boolean;

  @ApiPropertyOptional({ description: 'Manual invoice discount (amount, spread over the lines); replaces any automatic invoice discount' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  invoiceDiscount?: number;

  @ApiProperty({ type: [CreateSalesOrderLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateSalesOrderLineDto)
  lines: CreateSalesOrderLineDto[];
}
