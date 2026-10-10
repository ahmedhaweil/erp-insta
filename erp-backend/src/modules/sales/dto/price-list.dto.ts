import {
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
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { PriceRuleType } from '../entities/price-list-rule.entity';

export class PriceListRuleDto {
  @ApiPropertyOptional({ description: 'Product the rule applies to' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ description: 'Product category (and sub-categories); ignored with productId' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiProperty({ enum: PriceRuleType, description: 'fixed price, discount % on sales price or markup % on cost' })
  @IsEnum(PriceRuleType)
  ruleType: PriceRuleType;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  value: number;

  @ApiPropertyOptional({ description: 'Minimum quantity (tier)', default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minQuantity?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() validFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() validTo?: string;
}

export class CreatePriceListDto {
  @ApiProperty() @IsString() name: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() currencyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() validFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() validTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;

  @ApiPropertyOptional({ type: [PriceListRuleDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PriceListRuleDto)
  rules?: PriceListRuleDto[];
}

export class UpdatePriceListDto extends PartialType(CreatePriceListDto) {}

export class PriceQueryDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  quantity?: number;

  @ApiPropertyOptional({ description: 'Pricing date (default today)' })
  @IsOptional()
  @IsString()
  date?: string;

  @ApiPropertyOptional({ description: 'Explicit price list' })
  @IsOptional()
  @IsUUID()
  priceListId?: string;
}

export class CreateCustomerCategoryDto {
  @ApiProperty() @IsString() code: string;
  @ApiProperty() @IsString() nameAr: string;
  @ApiPropertyOptional() @IsOptional() @IsString() nameEn?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() priceListId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ description: 'Soft balance threshold of the category customers (warning only)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  balanceWarningThreshold?: number;
}

export class UpdateCustomerCategoryDto extends PartialType(CreateCustomerCategoryDto) {}

export class MinSellPriceDto {
  @ApiProperty({ nullable: true, description: 'Minimum net unit price; null clears it' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minSellPrice: number | null;
}
