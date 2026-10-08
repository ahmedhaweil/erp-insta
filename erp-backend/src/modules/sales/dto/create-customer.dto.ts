import { IsString, IsOptional, IsBoolean, IsNumber, IsEmail, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCustomerDto {
  @ApiProperty()
  @IsString()
  code: string;

  @ApiProperty()
  @IsString()
  nameAr: string;

  @ApiProperty()
  @IsString()
  nameEn: string;

  @ApiProperty()
  @IsString()
  phone: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  taxId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  creditLimit?: number;

  @ApiPropertyOptional({ description: 'Payment terms in days' })
  @IsOptional()
  @IsNumber()
  paymentTermDays?: number;

  @ApiPropertyOptional({ description: 'Customer category / group' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Price list (overrides the category price list)' })
  @IsOptional()
  @IsUUID()
  priceListId?: string;

  @ApiPropertyOptional({ description: 'Default sales representative' })
  @IsOptional()
  @IsUUID()
  salesRepId?: string;
}
