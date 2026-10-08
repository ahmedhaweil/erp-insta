import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import { RecurringFrequency } from '../entities/recurring-entry.entity';
import { DeferralType } from '../entities/deferral-schedule.entity';

// ------------------------------------------------------------ recurring

export class RecurringLineDto {
  @ApiProperty() @IsUUID() accountId: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) debit?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) credit?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() costCenterId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
}

export class CreateRecurringEntryDto {
  @ApiProperty() @IsString() name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() journalId?: string;

  @ApiProperty({ enum: RecurringFrequency })
  @IsEnum(RecurringFrequency)
  frequency: RecurringFrequency;

  @ApiPropertyOptional({ description: 'Required with frequency "days"' })
  @IsOptional()
  @IsInt()
  @Min(1)
  intervalDays?: number;

  @ApiProperty() @IsDateString() startDate: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endDate?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  autoPost?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsUUID() currencyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) exchangeRate?: number;

  @ApiProperty({ type: [RecurringLineDto] })
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => RecurringLineDto)
  lines: RecurringLineDto[];
}

export class UpdateRecurringEntryDto extends PartialType(
  OmitType(CreateRecurringEntryDto, ['startDate'] as const),
) {
  @ApiPropertyOptional({ enum: ['active', 'paused', 'done'] })
  @IsOptional()
  @IsIn(['active', 'paused', 'done'])
  status?: 'active' | 'paused' | 'done';
}

export class RunDueDto {
  @ApiPropertyOptional({ description: 'Generate everything due up to this date (default today)' })
  @IsOptional()
  @IsDateString()
  asOf?: string;
}

// ------------------------------------------------------------ deferrals

export class CreateDeferralDto {
  @ApiProperty({ enum: DeferralType }) @IsEnum(DeferralType) type: DeferralType;
  @ApiProperty() @IsString() name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reference?: string;
  @ApiProperty() @IsNumber() @Min(0.01) amount: number;

  @ApiProperty({ description: 'Deferred revenue (liability) or prepaid expense (asset) account' })
  @IsUUID()
  deferralAccountId: string;

  @ApiProperty({ description: 'Revenue or expense account recognised monthly' })
  @IsUUID()
  plAccountId: string;

  @ApiProperty() @IsDateString() startDate: string;
  @ApiProperty() @IsInt() @Min(1) @Max(600) months: number;

  @ApiPropertyOptional({
    description:
      'When set, an initial entry is posted on the start date: revenue Dr counterpart / Cr deferral; expense Dr deferral / Cr counterpart',
  })
  @IsOptional()
  @IsUUID()
  counterpartAccountId?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() costCenterId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
}

export class CancelDeferralDto {
  @ApiPropertyOptional({
    description: 'Recognise the whole remaining amount in one entry on `date` instead of leaving it deferred',
  })
  @IsOptional()
  @IsBoolean()
  recognizeRemaining?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
}

// ------------------------------------------------------- fx revaluation

export class FxRateDto {
  @ApiProperty() @IsUUID() currencyId: string;
  @ApiProperty({ description: 'Base-currency units per unit of the currency' })
  @IsNumber()
  @Min(0.000001)
  rate: number;
}

export class FxRevaluationDto {
  @ApiProperty() @IsDateString() date: string;

  @ApiPropertyOptional({
    type: [FxRateDto],
    description: 'Rates to use; missing currencies take the latest exchange_rates row on or before the date',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FxRateDto)
  rates?: FxRateDto[];

  @ApiPropertyOptional({ description: 'Defaults to the day after `date`\'s month end' })
  @IsOptional()
  @IsDateString()
  reversalDate?: string;
}

export class ReverseRevaluationDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() date?: string;
}

// ------------------------------------------------------ opening balances

export class OpeningAccountLineDto {
  @ApiProperty() @IsUUID() accountId: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) debit?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) credit?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() costCenterId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
}

export class OpeningAccountsDto {
  @ApiProperty() @IsDateString() date: string;

  @ApiPropertyOptional({
    description: 'Opening balance equity account; defaults to retained earnings from the settings',
  })
  @IsOptional()
  @IsUUID()
  equityAccountId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;

  @ApiPropertyOptional({
    description: 'Allow lines on the receivable/payable control accounts (normally opened per partner)',
  })
  @IsOptional()
  @IsBoolean()
  allowControlAccounts?: boolean;

  @ApiProperty({ type: [OpeningAccountLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OpeningAccountLineDto)
  lines: OpeningAccountLineDto[];
}

export class OpeningPartnerDocumentDto {
  @ApiProperty({ enum: ['customer', 'supplier'] })
  @IsIn(['customer', 'supplier'])
  partnerType: 'customer' | 'supplier';

  @ApiProperty() @IsUUID() partnerId: string;

  @ApiProperty({
    description:
      'Open amount in document currency. Positive: the customer owes us / we owe the supplier; negative: a credit balance',
  })
  @IsNumber()
  amount: number;

  @ApiPropertyOptional() @IsOptional() @IsDateString() dueDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reference?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() currencyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0.000001) exchangeRate?: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
}

export class OpeningPartnersDto {
  @ApiProperty() @IsDateString() date: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() equityAccountId?: string;

  @ApiProperty({ type: [OpeningPartnerDocumentDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OpeningPartnerDocumentDto)
  documents: OpeningPartnerDocumentDto[];
}

// --------------------------------------------------------- period close

export class PeriodLockDto {
  @ApiPropertyOptional({ description: 'Month to lock, YYYY-MM (locks up to its last day)' })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  period?: string;

  @ApiPropertyOptional({ description: 'Exact lock date (alternative to period)' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class PeriodReopenDto {
  @ApiPropertyOptional({ description: 'New (earlier) lock date; omit to remove the lock' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}
