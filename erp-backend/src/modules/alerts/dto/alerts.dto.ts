import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { NotificationType } from '@modules/notifications/entities/notification.entity';
import { AlertType } from '../alert-types';

export class CreateAlertRuleDto {
  @ApiProperty({ enum: AlertType })
  @IsEnum(AlertType)
  type: AlertType;

  @ApiPropertyOptional({ description: 'Defaults to the type title' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Days threshold; meaning depends on the type (GET /alerts/types)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3650)
  thresholdDays?: number | null;

  @ApiPropertyOptional({ description: 'Hours threshold (POS sessions)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  thresholdHours?: number | null;

  @ApiPropertyOptional({ description: 'Type options: chequeType, minAmount, warehouseId' })
  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [String], description: 'Users notified' })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  recipientUserIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Every active user holding one of these roles is notified' })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  recipientRoleIds?: string[];

  @ApiPropertyOptional({ enum: NotificationType })
  @IsOptional()
  @IsEnum(NotificationType)
  severity?: NotificationType | null;
}

export class UpdateAlertRuleDto extends PartialType(CreateAlertRuleDto) {}

export class ScanAlertsDto {
  @ApiPropertyOptional({ description: 'Scan only this rule' })
  @IsOptional()
  @IsUUID()
  ruleId?: string;

  @ApiPropertyOptional({ description: 'Return the matches without notifying anyone' })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

export class AlertDeliveryQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  ruleId?: string;

  @ApiPropertyOptional({ description: 'From date (default 7 days ago)' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ default: 200 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;
}
