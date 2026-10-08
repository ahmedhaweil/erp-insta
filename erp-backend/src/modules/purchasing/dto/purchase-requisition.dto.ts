import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RequisitionLineDto {
  @ApiProperty() @IsUUID() productId: string;

  @ApiProperty()
  @IsNumber()
  @Min(0.0001)
  quantity: number;

  @ApiPropertyOptional({ description: 'Estimated unit price (defaults the RFQ price)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  estimatedPrice?: number;

  @ApiPropertyOptional({ description: 'Suggested vendor (else the product preferred supplier)' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
}

export class CreatePurchaseRequisitionDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;
  @ApiPropertyOptional({ description: 'Requesting department' })
  @IsOptional()
  @IsString()
  departmentName?: string;

  @ApiPropertyOptional({ description: 'Default today' }) @IsOptional() @IsString() date?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() requiredDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;

  @ApiProperty({ type: [RequisitionLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RequisitionLineDto)
  lines: RequisitionLineDto[];
}

export class ConvertRequisitionDto {
  @ApiPropertyOptional({ description: 'Vendor for every line (overrides line / preferred vendors)' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({ description: 'RFQ date (default today)' })
  @IsOptional()
  @IsString()
  date?: string;
}
