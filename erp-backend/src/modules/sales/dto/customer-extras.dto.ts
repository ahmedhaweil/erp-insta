import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

export class BlockCustomerDto {
  @ApiProperty({ description: 'Why the customer is blocked (shown when a sale is refused)' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class CreateCustomerAddressDto {
  @ApiProperty() @IsString() @IsNotEmpty() label: string;
  @ApiProperty() @IsString() @IsNotEmpty() address: string;
  @ApiPropertyOptional() @IsOptional() @IsString() city?: string;
  @ApiPropertyOptional({ description: 'Delivery zone / area' })
  @IsOptional()
  @IsString()
  deliveryZone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional({ description: 'Default delivery address (the previous default is unset)' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateCustomerAddressDto extends PartialType(CreateCustomerAddressDto) {}
