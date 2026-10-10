import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { ReportOutputDto } from '@modules/reports/dto/report-filter.dto';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Scope of every analytics endpoint. The comparison period is the same length right before `from`. */
export class AnalyticsQueryDto extends ReportOutputDto {
  @ApiPropertyOptional({ example: '2026-10-01', description: 'Default: first day of the current month' })
  @IsOptional()
  @IsString()
  @Matches(DATE, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-09', description: 'Default: today' })
  @IsOptional()
  @IsString()
  @Matches(DATE, { message: 'to must be YYYY-MM-DD' })
  to?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;

  @ApiPropertyOptional({ description: 'Stock in this warehouse; sales delivered from it' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ description: 'Slow-moving threshold in days (default: settings, 30)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  stagnationDays?: number;

  @ApiPropertyOptional({ description: 'Low stock when days of cover ≤ this (default: settings, 14)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  lowCoverDays?: number;

  @ApiPropertyOptional({ description: 'Overstock when days of cover ≥ this (default: settings, 90)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  overstockDays?: number;

  @ApiPropertyOptional({ description: 'Purchase suggestions cover this many days (default: settings, 30)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  coverDays?: number;

  @ApiPropertyOptional({ description: 'Rows per derived list (default 20)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  limit?: number;
}

export class UpdateAnalyticsSettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(3650) stagnationDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(3650) lowCoverDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(3650) overstockDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(3650) purchaseCoverDays?: number;

  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(1000) salesDropPct?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(1000) salesRisePct?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(1000) profitDropPct?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(100) marginDropPoints?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(100) slowValueCriticalPct?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(100) topItemSharePct?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(100) topCustomerSharePct?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(100) returnsRatioPct?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(1000) expensesProfitWarnPct?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) posCashDiffMin?: number;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() alertCreditLimit?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() alertCustomerBalance?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) customerBalanceThreshold?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() alertSupplierBalance?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) supplierBalanceThreshold?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() alertMonthExpenses?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) monthExpensesThreshold?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() alertNegativeTreasury?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() alertNegativeStock?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() alertExpiringLots?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(3650) expiryDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() alertInstallments?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(365) installmentDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() alertCheques?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(365) chequeDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() autoNotify?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  notifyUserIds?: string[];
}
