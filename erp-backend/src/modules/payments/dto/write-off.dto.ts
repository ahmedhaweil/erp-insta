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
import { WriteOffKind, WriteOffStatus } from '../entities/partner-write-off.entity';

export class WriteOffLineDto {
  @ApiProperty({ description: 'Open sales invoice (customer) or vendor bill (supplier)' })
  @IsUUID()
  invoiceId: string;

  @ApiProperty({ description: 'Amount written off (at most the document residual)' })
  @IsNumber()
  @Min(0.0001)
  amount: number;
}

export class CreateWriteOffDto {
  @ApiProperty({ description: 'Customer id (sales) or supplier id (purchasing)' })
  @IsUUID()
  partnerId: string;

  @ApiPropertyOptional({ description: 'Document date (default today)' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({
    enum: WriteOffKind,
    default: WriteOffKind.WRITE_OFF,
    description:
      'write_off: bad debt expense (customer) / write-off income (supplier); discount: discount allowed / received; custom: `accountId`',
  })
  @IsOptional()
  @IsEnum(WriteOffKind)
  kind?: WriteOffKind;

  @ApiPropertyOptional({ description: 'Counterpart GL account (required for kind=custom)' })
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional({
    type: [WriteOffLineDto],
    description: 'Documents and amounts; when omitted the open documents are taken oldest first',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WriteOffLineDto)
  lines?: WriteOffLineDto[];

  @ApiPropertyOptional({
    description:
      'Without lines: total to write off over the open documents oldest first (default: the whole open residual)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0.0001)
  amount?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;

  @ApiPropertyOptional({ description: 'Post immediately' })
  @IsOptional()
  @IsBoolean()
  post?: boolean;
}

export class WriteOffQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() partnerId?: string;

  @ApiPropertyOptional({ enum: WriteOffStatus })
  @IsOptional()
  @IsEnum(WriteOffStatus)
  status?: WriteOffStatus;
}
