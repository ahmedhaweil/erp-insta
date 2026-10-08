import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApprovalDocumentType } from '../entities/approval-rule.entity';
import { ApprovalRequestStatus } from '../entities/approval-request.entity';

export class ApprovalLevelDto {
  @ApiPropertyOptional({ description: '1-based order; defaults to the position in the list' })
  @IsOptional()
  @IsInt()
  @Min(1)
  sequence?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;

  @ApiPropertyOptional({ description: 'Members of this role may approve' })
  @IsOptional()
  @IsUUID()
  roleId?: string;

  @ApiPropertyOptional({ type: [String], description: 'Specific users who may approve' })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  userIds?: string[];

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  minApprovers?: number;
}

export class CreateApprovalRuleDto {
  @ApiProperty() @IsString() name: string;

  @ApiProperty({ enum: ApprovalDocumentType })
  @IsEnum(ApprovalDocumentType)
  documentType: ApprovalDocumentType;

  @ApiPropertyOptional({ description: 'Applies to amounts above this (base currency)', default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minAmount?: number;

  @ApiPropertyOptional({ description: 'Inclusive upper bound' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxAmount?: number;

  @ApiPropertyOptional() @IsOptional() @IsInt() priority?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowSelfApproval?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;

  @ApiProperty({ type: [ApprovalLevelDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ApprovalLevelDto)
  levels: ApprovalLevelDto[];
}

export class UpdateApprovalRuleDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) minAmount?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) maxAmount?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() priority?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowSelfApproval?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;

  @ApiPropertyOptional({ type: [ApprovalLevelDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ApprovalLevelDto)
  levels?: ApprovalLevelDto[];
}

export class ApprovalDecisionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() comment?: string;
}

export class ApprovalRequestQueryDto {
  @ApiPropertyOptional({ enum: ApprovalDocumentType })
  @IsOptional()
  @IsEnum(ApprovalDocumentType)
  documentType?: ApprovalDocumentType;

  @ApiPropertyOptional() @IsOptional() @IsUUID() documentId?: string;

  @ApiPropertyOptional({ enum: ApprovalRequestStatus })
  @IsOptional()
  @IsEnum(ApprovalRequestStatus)
  status?: ApprovalRequestStatus;

  @ApiPropertyOptional() @IsOptional() @IsUUID() requestedBy?: string;
}

export class SubmitApprovalDto {
  @ApiProperty({ enum: ApprovalDocumentType })
  @IsEnum(ApprovalDocumentType)
  documentType: ApprovalDocumentType;

  @ApiPropertyOptional() @IsOptional() @IsUUID() documentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() documentRef?: string;

  @ApiProperty({ description: 'Base-currency amount' })
  @IsNumber()
  @Min(0)
  amount: number;

  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
}
