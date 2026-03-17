import { IsUUID, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { EInvoiceType } from '../entities/e-invoice.entity';

export class SubmitInvoiceDto {
  @ApiProperty()
  @IsUUID()
  invoiceId: string;

  @ApiProperty({ enum: EInvoiceType })
  @IsEnum(EInvoiceType)
  invoiceType: EInvoiceType;
}
