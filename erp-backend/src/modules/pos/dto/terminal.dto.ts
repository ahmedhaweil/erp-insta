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
  ValidateNested,
} from 'class-validator';
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
  @ApiProperty() @IsUUID() productId: string;
  @ApiProperty() @IsNumber() @Min(0.0001) quantity: number;
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
