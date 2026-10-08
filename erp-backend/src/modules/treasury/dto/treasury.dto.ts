import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import { TreasuryType } from '../entities/treasury.entity';
import { VoucherType } from '../entities/treasury-voucher.entity';
import { ChequeStatus, ChequeType } from '../entities/cheque.entity';
import { PaymentAllocationDto } from '@modules/payments/dto/create-payment.dto';

// ---------------------------------------------------------------- treasuries

export class CreateTreasuryDto {
  @ApiProperty() @IsString() @IsNotEmpty() code: string;
  @ApiProperty() @IsString() @IsNotEmpty() nameAr: string;
  @ApiPropertyOptional() @IsOptional() @IsString() nameEn?: string;
  @ApiProperty({ enum: TreasuryType }) @IsEnum(TreasuryType) type: TreasuryType;
  @ApiProperty({ description: 'GL account of this cash box / bank account' })
  @IsUUID()
  accountId: string;
  @ApiPropertyOptional({ description: 'Omit for the base currency' })
  @IsOptional()
  @IsUUID()
  currencyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() bankName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() bankBranch?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() accountNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() iban?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() swiftCode?: string;
  @ApiPropertyOptional({
    description:
      'Opening balance in the treasury currency; posted Dr treasury / Cr retained earnings when accounting is enabled',
  })
  @IsOptional()
  @IsNumber()
  openingBalance?: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString() openingDate?: string;
  @ApiPropertyOptional({ description: 'Base units per treasury-currency unit for the opening entry' })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  openingRate?: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() custodianUserId?: string;
  @ApiPropertyOptional({ type: [String], description: 'Additional custodians' })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  custodianUserIds?: string[];
  @ApiPropertyOptional({
    description: 'Allow a negative balance (default: false for cash boxes, true for banks)',
  })
  @IsOptional()
  @IsBoolean()
  allowNegative?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class UpdateTreasuryDto extends PartialType(
  OmitType(CreateTreasuryDto, [
    'accountId',
    'currencyId',
    'openingBalance',
    'openingDate',
    'openingRate',
  ] as const),
) {}

export class DateRangeQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
}

// ---------------------------------------------------------------- vouchers

export class VoucherLineDto {
  @ApiProperty() @IsUUID() accountId: string;
  @ApiProperty() @IsNumber() @Min(0.0001) amount: number;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() costCenterId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
}

export class CreateVoucherDto {
  @ApiProperty({ enum: VoucherType }) @IsEnum(VoucherType) type: VoucherType;
  @ApiProperty() @IsUUID() treasuryId: string;
  @ApiProperty() @IsDateString() date: string;
  @ApiPropertyOptional({ description: 'Base units per treasury-currency unit (foreign treasuries)' })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  exchangeRate?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() counterpartyName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reference?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiProperty({ type: [VoucherLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => VoucherLineDto)
  lines: VoucherLineDto[];
  @ApiPropertyOptional({ description: 'Post immediately' })
  @IsOptional()
  @IsBoolean()
  post?: boolean;
}

export class UpdateVoucherDto extends PartialType(OmitType(CreateVoucherDto, ['post'] as const)) {}

export class VoucherQueryDto extends DateRangeQueryDto {
  @ApiPropertyOptional({ enum: VoucherType }) @IsOptional() @IsEnum(VoucherType) type?: VoucherType;
  @ApiPropertyOptional() @IsOptional() @IsUUID() treasuryId?: string;
}

export class CancelDto {
  @ApiPropertyOptional({ description: 'Date of the reversal entry (defaults to today)' })
  @IsOptional()
  @IsDateString()
  date?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
}

// ---------------------------------------------------------------- transfers

export class CreateTransferDto {
  @ApiProperty() @IsUUID() fromTreasuryId: string;
  @ApiProperty() @IsUUID() toTreasuryId: string;
  @ApiProperty() @IsDateString() date: string;
  @ApiProperty({ description: 'Amount leaving the source treasury (its currency), fee excluded' })
  @IsNumber()
  @Min(0.0001)
  amount: number;
  @ApiPropertyOptional({
    description:
      'Destination units per source unit; required when the currencies differ (or give toAmount)',
  })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  rate?: number;
  @ApiPropertyOptional({ description: 'Amount received by the destination (its currency)' })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  toAmount?: number;
  @ApiPropertyOptional({
    description:
      'Base units per source-currency unit (required when the source treasury is in a foreign currency, unless the destination is in base currency)',
  })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  baseRate?: number;
  @ApiPropertyOptional({ description: 'Bank fee on the source treasury, posted to bank charges' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  fee?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() reference?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional({ description: 'Post immediately' })
  @IsOptional()
  @IsBoolean()
  post?: boolean;
}

// ---------------------------------------------------------------- cheques

export class ChequeQueryDto {
  @ApiPropertyOptional({ enum: ChequeType }) @IsOptional() @IsEnum(ChequeType) type?: ChequeType;
  @ApiPropertyOptional({ enum: ChequeStatus })
  @IsOptional()
  @IsEnum(ChequeStatus)
  status?: ChequeStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() partnerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dueFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dueTo?: string;
}

export class ChequeReminderQueryDto {
  @ApiPropertyOptional({ description: 'Days ahead (default 7)', default: 7 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  days?: number;
  @ApiPropertyOptional({ enum: ChequeType }) @IsOptional() @IsEnum(ChequeType) type?: ChequeType;
  @ApiPropertyOptional() @IsOptional() @IsUUID() treasuryId?: string;
  @ApiPropertyOptional({ description: 'Reference date (default today)' })
  @IsOptional()
  @IsDateString()
  asOf?: string;
  @ApiPropertyOptional({ description: 'Include overdue cheques (default true)' })
  @IsOptional()
  @IsString()
  includeOverdue?: string;
}

export class ChequeDueQueryDto {
  @ApiProperty() @IsDateString() from: string;
  @ApiProperty() @IsDateString() to: string;
  @ApiPropertyOptional({ enum: ChequeType }) @IsOptional() @IsEnum(ChequeType) type?: ChequeType;
}

export class DepositChequeDto {
  @ApiProperty({ description: 'Bank treasury the cheque is deposited in' })
  @IsUUID()
  treasuryId: string;
  @ApiProperty() @IsDateString() date: string;
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
}

export class SettleChequeDto {
  @ApiProperty() @IsDateString() date: string;
  @ApiPropertyOptional({
    description:
      'Foreign-currency cheques: base units per cheque-currency unit at collection/clearing; the difference with the booked rate goes to fxGain / fxLoss',
  })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  exchangeRate?: number;
  @ApiPropertyOptional({
    description:
      'Bank treasury; defaults to the deposit bank (received) or the bank it is drawn on (issued)',
  })
  @IsOptional()
  @IsUUID()
  treasuryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
}

export class BounceChequeDto {
  @ApiProperty() @IsDateString() date: string;
  @ApiPropertyOptional({ description: 'Bank charge for the bounced cheque (treasury currency)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  bankCharge?: number;
  @ApiPropertyOptional({ description: 'Re-charge the bank fee to the customer' })
  @IsOptional()
  @IsBoolean()
  chargeToCustomer?: boolean;
  @ApiPropertyOptional({
    description: 'Bank treasury paying the charge (defaults to the deposit bank / the bank the cheque is drawn on)',
  })
  @IsOptional()
  @IsUUID()
  treasuryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
}

export class ReturnChequeDto {
  @ApiProperty() @IsDateString() date: string;
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
}

export class EndorseChequeDto {
  @ApiProperty() @IsUUID() supplierId: string;
  @ApiProperty() @IsDateString() date: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reference?: string;
  @ApiPropertyOptional({ type: [PaymentAllocationDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PaymentAllocationDto)
  allocations?: PaymentAllocationDto[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() autoAllocate?: boolean;
}

// ---------------------------------------------------------------- reconciliation

export class StatementLineDto {
  @ApiProperty() @IsDateString() date: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reference?: string;
  @ApiProperty({ description: 'Signed: positive = deposit, negative = withdrawal' })
  @IsNumber()
  amount: number;
}

export class ImportStatementDto {
  @ApiProperty() @IsUUID() treasuryId: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reference?: string;
  @ApiPropertyOptional({ description: 'Defaults to the first line date' })
  @IsOptional()
  @IsDateString()
  startDate?: string;
  @ApiPropertyOptional({ description: 'Defaults to the last line date' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() openingBalance?: number;
  @ApiPropertyOptional({ description: 'Defaults to opening + lines' })
  @IsOptional()
  @IsNumber()
  closingBalance?: number;
  @ApiPropertyOptional({ type: [StatementLineDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StatementLineDto)
  lines?: StatementLineDto[];
  @ApiPropertyOptional({
    description:
      'CSV text with a header row: date, description, reference and either amount or debit/credit (withdrawal/deposit) columns',
  })
  @IsOptional()
  @IsString()
  csv?: string;
  @ApiPropertyOptional({
    description:
      'SWIFT MT940 statement text; its :60F:/:62F: balances are used unless openingBalance/closingBalance are given',
  })
  @IsOptional()
  @IsString()
  mt940?: string;
}

export class AutoMatchDto {
  @ApiPropertyOptional({ description: 'Max days between bank and book dates', default: 7 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(90)
  dayTolerance?: number;
}

export class ManualMatchDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('all', { each: true })
  journalLineIds: string[];
}

export class StatementLineVoucherDto {
  @ApiPropertyOptional({
    description: 'Counterpart account; defaults to bank charges for withdrawals',
  })
  @IsOptional()
  @IsUUID()
  accountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() costCenterId?: string;
}
