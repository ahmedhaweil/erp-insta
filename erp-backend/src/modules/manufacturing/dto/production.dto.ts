import { LotInputDto } from '@modules/inventory/dto/lot-input.dto';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductionOrderStatus } from '../entities/production-order.entity';

export class CreateProductionOrderDto {
  @ApiPropertyOptional({ description: 'BOM to use (default: active BOM of the product)' })
  @IsOptional()
  @IsUUID()
  bomId?: string;

  @ApiPropertyOptional({ description: 'Finished product (required when bomId is omitted)' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiProperty() @IsNumber() @Min(0.0001) quantity: number;

  @ApiProperty({ description: 'Warehouse components are consumed from' })
  @IsUUID()
  sourceWarehouseId: string;

  @ApiPropertyOptional({ description: 'Warehouse finished goods are received into (default: source)' })
  @IsOptional()
  @IsUUID()
  destinationWarehouseId?: string;

  @ApiPropertyOptional() @IsOptional() @IsDateString() plannedDate?: string;

  @ApiPropertyOptional({
    description: 'Explode sub-assemblies that have their own active BOM into their components',
  })
  @IsOptional()
  @IsBoolean()
  explode?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class ConfirmProductionOrderDto {
  @ApiPropertyOptional({ description: 'Reserve the components in the source warehouse' })
  @IsOptional()
  @IsBoolean()
  reserve?: boolean;

  @ApiPropertyOptional({ description: 'Confirm even when components are short' })
  @IsOptional()
  @IsBoolean()
  allowShortage?: boolean;
}

export class ConsumptionDto {
  @ApiProperty() @IsUUID() productId: string;

  @ApiProperty({ description: 'Actual quantity consumed (components) or produced (by-products)' })
  @IsNumber()
  @Min(0)
  quantity: number;

  @ApiPropertyOptional({
    type: [LotInputDto],
    description: 'Lots/serials consumed (components, FEFO when omitted) or produced (by-products)',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LotInputDto)
  lots?: LotInputDto[];
}

export class ProduceDto {
  @ApiProperty({ description: 'Finished quantity produced in this run' })
  @IsNumber()
  @Min(0.0001)
  quantity: number;

  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;

  @ApiPropertyOptional({
    type: [ConsumptionDto],
    description: 'Actual quantities when they differ from the BOM (variance)',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConsumptionDto)
  consumption?: ConsumptionDto[];

  @ApiPropertyOptional({
    type: [LotInputDto],
    description: 'Lots/serial numbers of the finished product (automatic lot named after the order when omitted)',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LotInputDto)
  lots?: LotInputDto[];

  @ApiPropertyOptional({ description: 'Close the order after this run even if under-produced' })
  @IsOptional()
  @IsBoolean()
  finish?: boolean;
}

export class CreateScrapDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() productionOrderId?: string;
  @ApiProperty() @IsUUID() productId: string;

  @ApiPropertyOptional({ description: 'Default: the production order source warehouse' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiProperty() @IsNumber() @Min(0.0001) quantity: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
}

export class ProductionOrderQueryDto {
  @ApiPropertyOptional({ enum: ProductionOrderStatus })
  @IsOptional()
  @IsEnum(ProductionOrderStatus)
  status?: ProductionOrderStatus;

  @ApiPropertyOptional() @IsOptional() @IsUUID() productId?: string;
}

export class RequirementsQueryDto {
  @ApiPropertyOptional({ description: 'BOM to plan (or productId to use its active BOM)' })
  @IsOptional()
  @IsUUID()
  bomId?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() productId?: string;

  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0.0001) quantity: number;

  @ApiPropertyOptional({ description: 'Count availability in this warehouse only' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ description: 'Explode sub-assemblies into leaf components (default true)' })
  @IsOptional()
  @Transform(({ obj, key }) =>
    obj[key] === undefined ? undefined : obj[key] === true || obj[key] === 'true',
  )
  @IsBoolean()
  explode?: boolean;

  @ApiPropertyOptional({
    description:
      'Net available sub-assembly stock before exploding further (default true); only the uncovered part is exploded',
  })
  @IsOptional()
  @Transform(({ obj, key }) =>
    obj[key] === undefined ? undefined : obj[key] === true || obj[key] === 'true',
  )
  @IsBoolean()
  netSubAssemblies?: boolean;
}

export class MrpRequisitionDto extends RequirementsQueryDto {
  @ApiPropertyOptional({ description: 'Requesting department name (default "Manufacturing")' })
  @IsOptional()
  @IsString()
  departmentName?: string;

  @ApiPropertyOptional({ description: 'Date the components are needed by' })
  @IsOptional()
  @IsDateString()
  requiredDate?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;

  @ApiPropertyOptional({ description: 'Submit the requisition for approval right away' })
  @IsOptional()
  @IsBoolean()
  submit?: boolean;
}

export class ReverseRunDto {
  @ApiPropertyOptional({ description: 'Date of the reversal (default today)' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
}
