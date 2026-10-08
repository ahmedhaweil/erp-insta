import { IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import { EtaItemType } from '../entities/eta-item-code.entity';

export class UpsertItemCodeDto {
  @ApiProperty()
  @IsUUID()
  productId: string;

  @ApiProperty({ enum: EtaItemType })
  @IsEnum(EtaItemType)
  itemType: EtaItemType;

  @ApiProperty({ example: 'EG-113317713-1001' })
  @IsString()
  @MaxLength(100)
  itemCode: string;

  @ApiPropertyOptional({ example: 'EA' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  unitType?: string;

  @ApiPropertyOptional({ example: 'V009' })
  @IsOptional()
  @Matches(/^V0(0[1-9]|10)$/)
  taxSubtype?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateItemCodeDto extends PartialType(OmitType(UpsertItemCodeDto, ['productId'] as const)) {}
