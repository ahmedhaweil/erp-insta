import { IsString, IsEnum, IsOptional, IsBoolean, IsUUID, IsNumber, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductType, TrackingType } from '../entities/product.entity';

export class CreateProductDto {
  @ApiProperty()
  @IsString()
  code: string;

  @ApiProperty()
  @IsString()
  nameAr: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nameEn?: string;

  @ApiProperty({ enum: ProductType })
  @IsEnum(ProductType)
  type: ProductType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  barcode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sku?: string;

  @ApiProperty()
  @IsUUID()
  categoryId: string;

  @ApiProperty()
  @IsUUID()
  unitId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  costPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  sellPrice?: number;

  @ApiPropertyOptional({ description: 'Lowest unit price (net of tax) allowed without price override' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minSellPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional({ description: 'Minimum on-hand quantity before replenishment' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  reorderLevel?: number;

  @ApiPropertyOptional({ description: 'Quantity to order when replenishing' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  reorderQty?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  preferredSupplierId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  salesTaxRate?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  purchaseTaxRate?: number;

  @ApiPropertyOptional({ enum: TrackingType, description: 'Lot/serial tracking (default none)' })
  @IsOptional()
  @IsEnum(TrackingType)
  trackingType?: TrackingType;

  @ApiPropertyOptional({ description: 'Lots carry an expiry date (requires lot or serial tracking)' })
  @IsOptional()
  @IsBoolean()
  hasExpiry?: boolean;
}
