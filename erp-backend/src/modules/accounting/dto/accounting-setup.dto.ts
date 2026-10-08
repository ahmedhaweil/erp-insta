import { IsDateString, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AccountingSetupDto {
  @ApiProperty({ enum: ['eg', 'sa'], description: 'Chart of accounts template' })
  @IsIn(['eg', 'sa'])
  template: 'eg' | 'sa';

  @ApiProperty({ example: '2026-01-01', description: 'First day of the first (open) fiscal year' })
  @IsDateString()
  fiscalYearStart: string;

  @ApiPropertyOptional({ example: 'EGP', description: 'Defaults to EGP (eg) or SAR (sa)' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  @Matches(/^[A-Za-z]{3}$/)
  baseCurrency?: string;
}
