import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class PromotionRuleBaseDto {
  @ApiProperty()
  @IsString()
  nameAr: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nameEn?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD, inclusive' })
  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD, inclusive' })
  @IsOptional()
  @IsDateString()
  validTo?: string;

  @ApiPropertyOptional({ enum: ['sales', 'pos', 'both'], default: 'both' })
  @IsOptional()
  @IsIn(['sales', 'pos', 'both'])
  appliesTo?: 'sales' | 'pos' | 'both';

  @ApiPropertyOptional({ type: [String], description: 'Empty = every branch' })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  branchIds?: string[];

  @ApiPropertyOptional({ type: [Number], description: '0 = Sunday ... 6 = Saturday; empty = every day' })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekdays?: number[];

  @ApiPropertyOptional({ description: 'HH:mm, inclusive' })
  @IsOptional()
  @Matches(HHMM)
  startTime?: string;

  @ApiPropertyOptional({ description: 'HH:mm, exclusive; before startTime = wraps past midnight' })
  @IsOptional()
  @Matches(HHMM)
  endTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateCampaignDto extends PromotionRuleBaseDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  productIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Sub-categories are included' })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  categoryIds?: string[];

  @ApiProperty({ enum: ['percent', 'amount'], description: 'amount = fixed amount off per unit' })
  @IsIn(['percent', 'amount'])
  discountType: 'percent' | 'amount';

  @ApiProperty()
  @IsNumber()
  @Min(0)
  value: number;
}
export class UpdateCampaignDto extends PartialType(CreateCampaignDto) {}

export class BonusTierDto {
  @ApiProperty()
  @IsNumber()
  @Min(0.0001)
  minQty: number;

  @ApiProperty()
  @IsNumber()
  @Min(0.0001)
  freeQty: number;
}

export class CreateBonusRuleDto extends PromotionRuleBaseDto {
  @ApiProperty()
  @IsUUID()
  productId: string;

  @ApiPropertyOptional({ description: 'Only quantities sold in this unit count' })
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @ApiPropertyOptional({ description: 'Product given free; defaults to the purchased product' })
  @IsOptional()
  @IsUUID()
  freeProductId?: string;

  @ApiProperty({ type: [BonusTierDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BonusTierDto)
  tiers: BonusTierDto[];

  @ApiPropertyOptional({ default: false, description: 'Free quantity per multiple of minQty' })
  @IsOptional()
  @IsBoolean()
  repeat?: boolean;
}
export class UpdateBonusRuleDto extends PartialType(CreateBonusRuleDto) {}

export class CreateInvoiceDiscountDto extends PromotionRuleBaseDto {
  @ApiProperty({ enum: ['percent', 'amount'] })
  @IsIn(['percent', 'amount'])
  discountType: 'percent' | 'amount';

  @ApiProperty()
  @IsNumber()
  @Min(0)
  value: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minSubtotal?: number;

  @ApiPropertyOptional({ description: 'Null = no upper bound' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxSubtotal?: number;

  @ApiPropertyOptional({ enum: ['any', 'cash', 'credit'], default: 'any' })
  @IsOptional()
  @IsIn(['any', 'cash', 'credit'])
  paymentCondition?: 'any' | 'cash' | 'credit';

  @ApiPropertyOptional({ default: 0, description: 'Lowest wins' })
  @IsOptional()
  @IsInt()
  priority?: number;
}
export class UpdateInvoiceDiscountDto extends PartialType(CreateInvoiceDiscountDto) {}

export class PromotionListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(['true', 'false'])
  activeOnly?: string;
}

export class UpdatePromotionSettingsDto {
  @ApiPropertyOptional({ nullable: true, description: 'Null = no limit' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  maxTotalDiscountPercent?: number | null;
}

export class EvaluateLineDto {
  @ApiProperty()
  @IsUUID()
  productId: string;

  @ApiProperty()
  @IsNumber()
  @Min(0.0001)
  quantity: number;

  @ApiPropertyOptional({ description: 'Defaults to the product sale price' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @ApiPropertyOptional({ description: 'Manual line discount (amount)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  unitId?: string;
}

export class EvaluatePromotionsDto {
  @ApiPropertyOptional({ enum: ['sales', 'pos'], default: 'pos' })
  @IsOptional()
  @IsIn(['sales', 'pos'])
  channel?: 'sales' | 'pos';

  @ApiPropertyOptional({ description: 'Defaults to today' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({ description: 'HH:mm; defaults to the current time when date is today' })
  @IsOptional()
  @Matches(HHMM)
  time?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ enum: ['cash', 'credit'], default: 'cash' })
  @IsOptional()
  @IsIn(['cash', 'credit'])
  paymentCondition?: 'cash' | 'credit';

  @ApiPropertyOptional({ description: 'Manual invoice discount (amount)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  invoiceDiscount?: number;

  @ApiProperty({ type: [EvaluateLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => EvaluateLineDto)
  lines: EvaluateLineDto[];
}

export class PromotionReportQueryDto {
  @ApiProperty()
  @IsDateString()
  from: string;

  @ApiProperty()
  @IsDateString()
  to: string;
}

export class PriceCheckQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ description: 'Barcode or product code' })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ enum: ['sales', 'pos'], default: 'pos' })
  @IsOptional()
  @IsIn(['sales', 'pos'])
  channel?: 'sales' | 'pos';
}
