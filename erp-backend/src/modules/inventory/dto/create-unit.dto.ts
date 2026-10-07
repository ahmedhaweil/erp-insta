import { IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUnitDto {
  @ApiProperty() @IsString() nameAr: string;
  @ApiPropertyOptional() @IsOptional() @IsString() nameEn?: string;
  @ApiProperty() @IsString() symbol: string;

  @ApiPropertyOptional({ description: 'Reference unit for conversions (e.g. Dozen -> Unit)' })
  @IsOptional()
  @IsUUID()
  baseUnitId?: string;

  @ApiPropertyOptional({ description: 'How many base units one of this unit holds' })
  @IsOptional()
  @IsNumber()
  @Min(0.000001)
  conversionFactor?: number;
}
