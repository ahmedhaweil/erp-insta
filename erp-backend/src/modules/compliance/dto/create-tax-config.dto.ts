import { IsString, IsEnum, IsNumber, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TaxCountry } from '../entities/tax-config.entity';

export class CreateTaxConfigDto {
  @ApiProperty({ enum: TaxCountry })
  @IsEnum(TaxCountry)
  country: TaxCountry;

  @ApiProperty()
  @IsString()
  taxType: string;

  @ApiProperty()
  @IsNumber()
  rate: number;

  @ApiProperty()
  @IsString()
  nameAr: string;

  @ApiProperty()
  @IsString()
  nameEn: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
