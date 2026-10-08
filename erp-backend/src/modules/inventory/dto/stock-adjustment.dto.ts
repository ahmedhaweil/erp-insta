import { IsUUID, IsNumber, IsString, IsOptional, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LotInputDto } from './lot-input.dto';

export class StockAdjustmentDto {
  @ApiProperty()
  @IsUUID()
  productId: string;

  @ApiProperty()
  @IsUUID()
  warehouseId: string;

  @ApiProperty({ description: 'Positive to increase, negative to decrease' })
  @IsNumber()
  quantity: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({
    type: [LotInputDto],
    description: 'Lots/serials adjusted (tracked products). Losses default to FEFO, gains to an automatic lot.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LotInputDto)
  lots?: LotInputDto[];
}
