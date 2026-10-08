import { IsDateString, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** A lot/batch (or serial number) and its quantity on a stock move. */
export class LotInputDto {
  @ApiProperty({ description: 'Lot/batch number, or serial number for serial-tracked products' })
  @IsString()
  @MaxLength(100)
  lotNumber: string;

  @ApiProperty({ description: 'Quantity in base unit (1 for serial numbers)' })
  @IsNumber()
  @Min(0.0001)
  quantity: number;

  @ApiPropertyOptional({ description: 'Expiry date (YYYY-MM-DD), required on receipt when the product has expiry' })
  @IsOptional()
  @IsDateString()
  expiryDate?: string;
}
