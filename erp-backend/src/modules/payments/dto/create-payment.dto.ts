import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
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

/** Details of a cheque received (inbound) or issued (outbound) with a cheque payment. */
export class PaymentChequeDto {
  @ApiProperty() @IsString() @IsNotEmpty() chequeNumber: string;
  @ApiPropertyOptional() @IsOptional() @IsString() bankName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() bankBranch?: string;
  @ApiPropertyOptional({ description: 'Who signed the cheque' })
  @IsOptional()
  @IsString()
  drawer?: string;
  @ApiProperty() @IsDateString() dueDate: string;
  @ApiPropertyOptional({ description: 'Defaults to the payment date' })
  @IsOptional()
  @IsDateString()
  issueDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
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

  @ApiPropertyOptional({
    description:
      'Cash box / bank treasury. For cheque payments: the bank an issued cheque is drawn on.',
  })
  @IsOptional()
  @IsUUID()
  treasuryId?: string;

  @ApiPropertyOptional({ description: 'Base-currency units per payment-currency unit', default: 1 })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  exchangeRate?: number;

  @ApiPropertyOptional({
    description:
      'Tax withheld at source on top of `amount` (customer receipts and supplier payments only); the partner is settled for amount + withholdingAmount',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  withholdingAmount?: number;

  @ApiPropertyOptional({
    description:
      'Settlement discount on top of `amount` (customer receipts: discount allowed; supplier payments: discount received). The partner is settled for amount + withholdingAmount + discountAllowed',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discountAllowed?: number;

  @ApiPropertyOptional({ type: PaymentChequeDto, description: 'Required for method=cheque' })
  @IsOptional()
  @ValidateNested()
  @Type(() => PaymentChequeDto)
  cheque?: PaymentChequeDto;

  @ApiPropertyOptional({
    description:
      'Outbound cheque payment made by endorsing a received cheque in the portfolio (instead of issuing a new one)',
  })
  @IsOptional()
  @IsUUID()
  endorsedChequeId?: string;

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
