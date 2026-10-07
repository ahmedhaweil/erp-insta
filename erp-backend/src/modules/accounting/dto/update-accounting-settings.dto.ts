import { IsOptional, IsUUID, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateAccountingSettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() receivableAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() payableAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() salesAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() purchaseAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() inventoryAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() cogsAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() stockAdjustmentAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() outputTaxAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() inputTaxAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() cashAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() bankAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() retainedEarningsAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() depreciationExpenseAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() accumulatedDepreciationAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() assetDisposalAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() lockDate?: string;
}
