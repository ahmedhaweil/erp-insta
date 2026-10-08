import { IsEnum, IsOptional, IsString, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReceiverType } from '../entities/compliance-party.entity';

export class UpsertCompliancePartyDto {
  @ApiProperty({ enum: ReceiverType, description: 'B business, P person, F foreigner' })
  @IsEnum(ReceiverType)
  receiverType: ReceiverType;

  @ApiPropertyOptional({ description: 'Tax registration no., VAT no., national id or passport' })
  @IsOptional()
  @IsString()
  identifier?: string;

  @ApiPropertyOptional({ example: 'EG' })
  @IsOptional()
  @Matches(/^[A-Z]{2}$/)
  countryCode?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() governate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() regionCity?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() street?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() buildingNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() postalCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() district?: string;

  @ApiPropertyOptional({ description: 'ZATCA buyer id scheme: CRN, MOM, MLS, 700, SAG, NAT, GCC, IQA, PAS, OTH' })
  @IsOptional()
  @IsString()
  otherIdScheme?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() otherId?: string;
}
