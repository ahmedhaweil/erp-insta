import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Query-string booleans; reads the raw value (implicit conversion would turn "false" into true). */
const toBool = ({ obj, key }: { obj: Record<string, unknown>; key: string }) => {
  const value = obj[key];
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return value;
};

/** Output options shared by every report endpoint. */
export class ReportOutputDto {
  @ApiPropertyOptional({ enum: ['json', 'xlsx', 'pdf'], description: 'xlsx / pdf return a file' })
  @IsOptional()
  @IsIn(['json', 'xlsx', 'pdf'])
  format?: 'json' | 'xlsx' | 'pdf';

  @ApiPropertyOptional({ enum: ['ar', 'en'], description: 'Language of Excel headers (default ar, right-to-left)' })
  @IsOptional()
  @IsIn(['ar', 'en'])
  lang?: 'ar' | 'en';
}

export class DateRangeFilterDto extends ReportOutputDto {
  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsString()
  @Matches(DATE, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsString()
  @Matches(DATE, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}

export class LedgerFilterDto extends DateRangeFilterDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  costCenterId?: string;
}

export class TrialBalanceFilterDto extends LedgerFilterDto {
  @ApiPropertyOptional({ description: 'Include parent (view) accounts with rolled-up totals' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  hierarchy?: boolean;

  @ApiPropertyOptional({ description: 'Include postable accounts without movements' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  includeZero?: boolean;

  @ApiPropertyOptional({ description: 'With hierarchy: only accounts up to this level (0 = classes)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  maxLevel?: number;
}

export class BalanceSheetFilterDto extends ReportOutputDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(DATE, { message: 'asOf must be YYYY-MM-DD' })
  asOf?: string;
}

export class GeneralLedgerFilterDto extends LedgerFilterDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional({ description: 'For a parent account: include all its descendants' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  includeChildren?: boolean;
}

export class PartnerStatementFilterDto extends DateRangeFilterDto {
  @ApiPropertyOptional({ enum: ['customer', 'supplier'] })
  @IsIn(['customer', 'supplier'])
  partnerType: 'customer' | 'supplier';

  @ApiPropertyOptional()
  @IsUUID()
  partnerId: string;
}

export class VatReturnFilterDto extends DateRangeFilterDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ enum: ['eg', 'sa'], description: 'Return layout; defaults to the tenant chart template' })
  @IsOptional()
  @IsIn(['eg', 'sa'])
  country?: 'eg' | 'sa';
}

export const SALES_GROUPS = ['product', 'customer', 'category', 'branch', 'salesperson', 'month', 'invoice', 'day'] as const;
export const PURCHASE_GROUPS = ['supplier', 'product', 'category', 'branch', 'month', 'invoice'] as const;

export class SalesAnalysisFilterDto extends DateRangeFilterDto {
  @ApiPropertyOptional({ enum: SALES_GROUPS, default: 'product' })
  @IsOptional()
  @IsIn(SALES_GROUPS as unknown as string[])
  groupBy?: (typeof SALES_GROUPS)[number];

  @ApiPropertyOptional({ enum: ['all', 'invoices', 'pos'], default: 'all' })
  @IsOptional()
  @IsIn(['all', 'invoices', 'pos'])
  source?: 'all' | 'invoices' | 'pos';

  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() productId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;

  @ApiPropertyOptional({ description: 'Return only the first N rows (by net amount)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  limit?: number;
}

export class PurchaseAnalysisFilterDto extends DateRangeFilterDto {
  @ApiPropertyOptional({ enum: PURCHASE_GROUPS, default: 'supplier' })
  @IsOptional()
  @IsIn(PURCHASE_GROUPS as unknown as string[])
  groupBy?: (typeof PURCHASE_GROUPS)[number];

  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() productId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  limit?: number;
}

export class DailySummaryFilterDto extends DateRangeFilterDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() userId?: string;
}

export class BudgetFilterDto extends ReportOutputDto {
  @ApiPropertyOptional()
  @IsUUID()
  fiscalYearId: string;
}
