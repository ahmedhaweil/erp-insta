import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class PrintQueryDto {
  @ApiPropertyOptional({ enum: ['ar', 'en'], default: 'ar' })
  @IsOptional()
  @IsIn(['ar', 'en'])
  lang?: 'ar' | 'en';

  @ApiPropertyOptional({ enum: ['a4', '80mm'], description: 'Paper size (default a4; 80mm for POS receipts)' })
  @IsOptional()
  @IsIn(['a4', '80mm'])
  paper?: 'a4' | '80mm';

  @ApiPropertyOptional({ description: 'inline (default) or attachment' })
  @IsOptional()
  @IsIn(['inline', 'attachment'])
  disposition?: 'inline' | 'attachment';
}

export class SalesOrderPrintQueryDto extends PrintQueryDto {
  @ApiPropertyOptional({
    enum: ['quotation', 'order'],
    description: 'Default: quotation while draft/sent, sales order once confirmed',
  })
  @IsOptional()
  @IsIn(['quotation', 'order'])
  kind?: 'quotation' | 'order';
}

export class DeliveryNoteQueryDto extends PrintQueryDto {
  @ApiPropertyOptional({
    description: 'Print only the goods delivered on this date (default: everything delivered so far)',
  })
  @IsOptional()
  @IsDateString()
  date?: string;
}

export class StatementPrintQueryDto extends PrintQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
}

export class ChequePrintQueryDto {
  @ApiPropertyOptional({ description: 'Layout to use (default: by bank account, bank name, then default)' })
  @IsOptional()
  @IsUUID()
  layoutId?: string;

  @ApiPropertyOptional({ enum: ['ar', 'en'], description: 'Language of the amount in words (default: layout)' })
  @IsOptional()
  @IsIn(['ar', 'en'])
  lang?: 'ar' | 'en';
}

export class ChequeFieldPositionDto {
  @ApiProperty({ description: 'mm from the left edge' }) @IsNumber() @Min(0) @Max(500) x: number;
  @ApiProperty({ description: 'mm from the top edge' }) @IsNumber() @Min(0) @Max(500) y: number;
  @ApiProperty({ description: 'box width in mm' }) @IsNumber() @Min(1) @Max(500) width: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(4) @Max(40) fontSize?: number;
  @ApiPropertyOptional({ enum: ['left', 'right', 'center'] })
  @IsOptional()
  @IsIn(['left', 'right', 'center'])
  align?: 'left' | 'right' | 'center';
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(1) @Max(5) maxLines?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() hidden?: boolean;
}

export class ChequeFieldsDto {
  @ApiPropertyOptional({ type: ChequeFieldPositionDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ChequeFieldPositionDto)
  date?: ChequeFieldPositionDto;

  @ApiPropertyOptional({ type: ChequeFieldPositionDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ChequeFieldPositionDto)
  payee?: ChequeFieldPositionDto;

  @ApiPropertyOptional({ type: ChequeFieldPositionDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ChequeFieldPositionDto)
  amount?: ChequeFieldPositionDto;

  @ApiPropertyOptional({ type: ChequeFieldPositionDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ChequeFieldPositionDto)
  amountWords?: ChequeFieldPositionDto;

  @ApiPropertyOptional({ type: ChequeFieldPositionDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ChequeFieldPositionDto)
  memo?: ChequeFieldPositionDto;
}

export class CreateChequeLayoutDto {
  @ApiProperty() @IsString() @IsNotEmpty() name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() bankName?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() treasuryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
  @ApiPropertyOptional({ default: 175 }) @IsOptional() @IsNumber() @Min(50) @Max(400) widthMm?: number;
  @ApiPropertyOptional({ default: 80 }) @IsOptional() @IsNumber() @Min(30) @Max(300) heightMm?: number;
  @ApiPropertyOptional({ enum: ['rtl', 'ltr'] }) @IsOptional() @IsIn(['rtl', 'ltr']) direction?: string;
  @ApiPropertyOptional({ enum: ['ar', 'en'] }) @IsOptional() @IsIn(['ar', 'en']) lang?: string;
  @ApiPropertyOptional({ example: 'DD/MM/YYYY' }) @IsOptional() @IsString() dateFormat?: string;
  @ApiPropertyOptional({ example: '#' }) @IsOptional() @IsString() amountFrame?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(-50) @Max(50) offsetX?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(-50) @Max(50) offsetY?: number;
  @ApiPropertyOptional({ type: ChequeFieldsDto, description: 'Missing fields use the default layout positions' })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ChequeFieldsDto)
  fields?: ChequeFieldsDto;
}

export class UpdateChequeLayoutDto extends PartialType(CreateChequeLayoutDto) {}
