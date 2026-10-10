import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentPartnerType } from '../entities/payment.entity';

export class OpeningBalanceLineDto {
  @ApiProperty({ enum: PaymentPartnerType })
  @IsEnum(PaymentPartnerType)
  partnerType: PaymentPartnerType;

  @ApiProperty() @IsUUID() partnerId: string;

  @ApiProperty({
    description:
      'Signed balance: positive = customer owes us / we owe the supplier; negative = advance or credit balance',
  })
  @IsNumber()
  amount: number;

  @ApiPropertyOptional({ description: 'Original document date used for ageing (default document date)' })
  @IsOptional()
  @IsDateString()
  originalDate?: string;

  @ApiPropertyOptional({ description: 'Due date (default original date)' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({ description: 'Original invoice number / reference' })
  @IsOptional()
  @IsString()
  reference?: string;
}

export class CreateOpeningBalanceDto {
  @ApiPropertyOptional({ description: 'Opening date (default today)' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;

  @ApiProperty({ type: [OpeningBalanceLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OpeningBalanceLineDto)
  lines: OpeningBalanceLineDto[];

  @ApiPropertyOptional({ description: 'Post immediately' })
  @IsOptional()
  @IsBoolean()
  post?: boolean;
}
