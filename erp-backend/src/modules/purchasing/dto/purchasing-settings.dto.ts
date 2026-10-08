import { IsBoolean, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdatePurchasingSettingsDto {
  @ApiPropertyOptional({
    description:
      'Purchase orders above this total (base currency) need approval before confirmation; 0 disables',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  poApprovalThreshold?: number;

  @ApiPropertyOptional({ description: 'Requisitions must be approved before conversion' })
  @IsOptional()
  @IsBoolean()
  requisitionApprovalRequired?: boolean;
}

export class RejectDto {
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
}
