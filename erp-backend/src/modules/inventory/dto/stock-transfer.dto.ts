import { IsUUID, IsNumber, IsOptional, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LotInputDto } from './lot-input.dto';

export class StockTransferDto {
  @ApiProperty()
  @IsUUID()
  productId: string;

  @ApiProperty()
  @IsUUID()
  fromWarehouseId: string;

  @ApiProperty()
  @IsUUID()
  toWarehouseId: string;

  @ApiProperty()
  @IsNumber()
  quantity: number;

  @ApiPropertyOptional({ type: [LotInputDto], description: 'Lots/serials moved (FEFO when omitted)' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LotInputDto)
  lots?: LotInputDto[];
}
