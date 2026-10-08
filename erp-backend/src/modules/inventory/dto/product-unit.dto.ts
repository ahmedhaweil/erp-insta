import { IsBoolean, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ProductUnitDto {
  @ApiProperty({ description: 'Alternate unit (e.g. carton)' })
  @IsUUID()
  unitId: string;

  @ApiProperty({ description: 'Base units in one of this unit (e.g. 12)' })
  @IsNumber()
  @Min(0.000001)
  factor: number;

  @ApiPropertyOptional({ description: 'Barcode printed on this packaging' })
  @IsOptional()
  @IsString()
  barcode?: string;

  @ApiPropertyOptional({ description: 'Sell price of one of this unit (default: product price x factor)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  sellPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
