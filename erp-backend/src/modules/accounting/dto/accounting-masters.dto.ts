import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { JournalType } from '../entities/journal.entity';

export class CreateJournalDto {
  @ApiProperty() @IsString() name: string;
  @ApiProperty({ enum: JournalType }) @IsEnum(JournalType) type: JournalType;
  @ApiPropertyOptional() @IsOptional() @IsUUID() defaultAccountId?: string;
}

export class CreateCostCenterDto {
  @ApiProperty() @IsString() code: string;
  @ApiProperty() @IsString() nameAr: string;
  @ApiPropertyOptional() @IsOptional() @IsString() nameEn?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() parentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
}

export class UpdateCostCenterDto extends PartialType(CreateCostCenterDto) {}

export class CreateExchangeRateDto {
  @ApiProperty() @IsUUID() currencyId: string;
  @ApiProperty({ description: 'Base-currency units per unit of the currency' })
  @IsNumber()
  @Min(0.000001)
  rate: number;
  @ApiProperty() @IsDateString() date: string;
}
