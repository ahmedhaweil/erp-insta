import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

export class BomComponentDto {
  @ApiProperty() @IsUUID() productId: string;

  @ApiProperty({ description: 'Quantity per BOM output quantity' })
  @IsNumber()
  @Min(0.0001)
  quantity: number;

  @ApiPropertyOptional({ description: 'Expected scrap (%) added to the quantity' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  scrapPercent?: number;
}

export class BomByProductDto {
  @ApiProperty() @IsUUID() productId: string;

  @ApiProperty({ description: 'Quantity per BOM output quantity' })
  @IsNumber()
  @Min(0.0001)
  quantity: number;

  @ApiPropertyOptional({ description: 'Share (%) of production cost assigned to the by-product' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(99)
  costSharePercent?: number;
}

export class CreateBomDto {
  @ApiProperty({ description: 'Finished product' })
  @IsUUID()
  productId: string;

  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;

  @ApiPropertyOptional({ description: 'Finished quantity the component quantities produce (default 1)' })
  @IsOptional()
  @IsNumber()
  @Min(0.0001)
  outputQuantity?: number;

  @ApiPropertyOptional({ description: 'Fixed labour cost per finished unit' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  labourCostPerUnit?: number;

  @ApiPropertyOptional({ description: 'Fixed overhead cost per finished unit' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  overheadCostPerUnit?: number;

  @ApiPropertyOptional({
    description: 'Make this version the active one (default: true when the product has no active BOM)',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;

  @ApiProperty({ type: [BomComponentDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BomComponentDto)
  components: BomComponentDto[];

  @ApiPropertyOptional({ type: [BomByProductDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BomByProductDto)
  byProducts?: BomByProductDto[];
}

export class UpdateBomDto extends PartialType(CreateBomDto) {}

export class BomQuantityQueryDto {
  @ApiPropertyOptional({ description: 'Finished quantity (default: BOM output quantity)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  quantity?: number;
}

export class BomExplodeQueryDto extends BomQuantityQueryDto {
  @ApiPropertyOptional({ description: 'Explode sub-assemblies with their own BOM (default true)' })
  @IsOptional()
  @Transform(({ obj, key }) =>
    obj[key] === undefined ? undefined : obj[key] === true || obj[key] === 'true',
  )
  @IsBoolean()
  multiLevel?: boolean;
}
