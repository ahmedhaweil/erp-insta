import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { ImportEntity, ImportJobStatus } from '../entities/import-job.entity';

/** Multipart fields arrive as strings: 'false' / '0' / 'no' must stay false. */
const toBool = ({ value }: { value: unknown }) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase());
};

export class ImportOptionsDto {
  @ApiPropertyOptional({ description: 'Update records whose code exists (default true); false skips them' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  updateExisting?: boolean;

  @ApiPropertyOptional({ description: 'Products: create missing categories and units (default false)' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  createMissing?: boolean;

  @ApiPropertyOptional({ description: 'Opening stock / balances: opening date (default today)' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({
    description:
      'Opening stock / balances: offset (opening equity) account id. Defaults: stock adjustment account (stock), retained earnings (balances)',
  })
  @IsOptional()
  @IsUUID()
  offsetAccountId?: string;

  @ApiPropertyOptional({ description: 'Offset account by code (alternative to offsetAccountId)' })
  @IsOptional()
  @IsString()
  offsetAccountCode?: string;
}

export class ImportJobQueryDto {
  @ApiPropertyOptional({ enum: ImportEntity })
  @IsOptional()
  @IsEnum(ImportEntity)
  entity?: ImportEntity;

  @ApiPropertyOptional({ enum: ImportJobStatus })
  @IsOptional()
  @IsEnum(ImportJobStatus)
  status?: ImportJobStatus;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class LangQueryDto {
  @ApiPropertyOptional({ enum: ['ar', 'en'], description: 'Sheet direction (default ar = right-to-left)' })
  @IsOptional()
  @IsIn(['ar', 'en'])
  lang?: 'ar' | 'en';
}

/** Uploaded file as given by multer (memory storage). */
export interface UploadedSpreadsheet {
  originalname: string;
  mimetype?: string;
  size: number;
  buffer: Buffer;
}
