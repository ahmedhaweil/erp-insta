import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentDirection, PaymentMethod, PaymentPartnerType } from '../entities/payment.entity';

export class PaymentAllocationDto {
  @ApiProperty() @IsUUID() invoiceId: string;
  @ApiProperty() @IsNumber() @Min(0.0001) amount: number;
}

export class CreatePaymentDto {
  @ApiProperty({ enum: PaymentPartnerType })
  @IsEnum(PaymentPartnerType)
  partnerType: PaymentPartnerType;

  @ApiProperty() @IsUUID() partnerId: string;

  @ApiPropertyOptional({
    enum: PaymentDirection,
    description:
      'Defaults to inbound for customers and outbound for suppliers; the opposite is a refund',
  })
  @IsOptional()
  @IsEnum(PaymentDirection)
  direction?: PaymentDirection;

  @ApiProperty() @IsNumber() @Min(0.0001) amount: number;
  @ApiProperty() @IsDateString() date: string;

  @ApiPropertyOptional({ enum: PaymentMethod })
  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @ApiPropertyOptional() @IsOptional() @IsString() reference?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() currencyId?: string;

  @ApiPropertyOptional({ type: [PaymentAllocationDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PaymentAllocationDto)
  allocations?: PaymentAllocationDto[];

  @ApiPropertyOptional({ description: 'Allocate to the oldest open invoices automatically' })
  @IsOptional()
  @IsBoolean()
  autoAllocate?: boolean;
}

export class AllocatePaymentDto {
  @ApiProperty({ type: [PaymentAllocationDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PaymentAllocationDto)
  allocations: PaymentAllocationDto[];
}
