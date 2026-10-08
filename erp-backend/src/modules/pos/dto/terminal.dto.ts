import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { LotInputDto } from '@modules/inventory/dto/lot-input.dto';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

export class CreateTerminalDto {
  @ApiProperty() @IsUUID() branchId: string;
  @ApiProperty() @IsString() name: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() printerIp?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cashDrawerPort?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() scalePort?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ description: 'Max discount % without override permission' })
  @IsOptional() @IsNumber() @Min(0) @Max(100) maxDiscountPercent?: number;
}

export class UpdateTerminalDto extends PartialType(CreateTerminalDto) {}

export class RefundLineDto {
  @ApiPropertyOptional({ description: 'Sale line to refund (or give productId)' })
  @IsOptional()
  @IsUUID()
  lineId?: string;

  @ApiPropertyOptional({ description: 'Product to refund, taken from its sale lines in order (or give lineId)' })
  @ValidateIf((l) => !l.lineId)
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ description: 'With productId: only sale lines in this unit (default: base-unit lines)' })
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @ApiProperty({ description: 'Quantity in the unit of the sale line' })
  @IsNumber()
  @Min(0.0001)
  quantity: number;

  @ApiPropertyOptional({
    type: [LotInputDto],
    description: 'Lots/serials returned (base units); must be among those sold. Default: the lots recorded on the sale',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LotInputDto)
  lots?: LotInputDto[];
}

export class RefundPosOrderDto {
  @ApiProperty({ description: 'Open session the refund is paid from' })
  @IsUUID()
  sessionId: string;

  @ApiPropertyOptional({ type: [RefundLineDto], description: 'Omit for a full refund' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RefundLineDto)
  lines?: RefundLineDto[];
}

export enum PosCashMovementType {
  IN = 'in',
  OUT = 'out',
}

export class CashMovementDto {
  @ApiProperty({ enum: PosCashMovementType }) @IsEnum(PosCashMovementType) type: PosCashMovementType;
  @ApiProperty() @IsNumber() @Min(0.01) amount: number;
  @ApiProperty() @IsString() reason: string;
  @ApiPropertyOptional({ description: 'Counterpart GL account (expense, bank, owner...)' })
  @IsOptional() @IsUUID() accountId?: string;
}
