import { IsUUID, IsEnum, IsOptional, IsString, MaxLength, IsDateString, IsIn, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EInvoiceProvider, EInvoiceStatus, EInvoiceType } from '../entities/e-invoice.entity';

export class SubmitInvoiceDto {
  @ApiProperty({ description: 'Posted sales invoice or credit note id' })
  @IsUUID()
  invoiceId: string;

  @ApiPropertyOptional({ enum: EInvoiceType, default: EInvoiceType.SALES })
  @IsOptional()
  @IsEnum(EInvoiceType)
  invoiceType?: EInvoiceType;
}

export class SubmitReceiptDto {
  @ApiProperty({ description: 'POS order id' })
  @IsUUID()
  posOrderId: string;
}

export class ReasonDto {
  @ApiProperty()
  @IsString()
  @MaxLength(500)
  reason: string;
}

export class ListComplianceDocumentsDto {
  @ApiPropertyOptional({ enum: EInvoiceProvider })
  @IsOptional()
  @IsEnum(EInvoiceProvider)
  provider?: EInvoiceProvider;

  @ApiPropertyOptional({ enum: EInvoiceStatus })
  @IsOptional()
  @IsEnum(EInvoiceStatus)
  status?: EInvoiceStatus;

  @ApiPropertyOptional({ description: 'From document date (inclusive)' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'To document date (inclusive)' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ description: 'Search internal id / uuid' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}
