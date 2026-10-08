import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { LeadSource, LeadStatus, LeadType } from '../entities/crm-lead.entity';
import { ActivityStatus, ActivityType } from '../entities/crm-activity.entity';
import { CreateSalesOrderLineDto } from '@modules/sales/dto/create-sales-order.dto';

// ---------- Stages ----------

export class CreateStageDto {
  @ApiProperty() @IsString() name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() nameAr?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() sequence?: number;

  @ApiPropertyOptional({ description: 'Default probability (%)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  probability?: number;

  @ApiPropertyOptional({ description: 'Leads moved to this stage are won' })
  @IsOptional()
  @IsBoolean()
  isWon?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateStageDto extends PartialType(CreateStageDto) {}

// ---------- Leads ----------

export class CreateLeadDto {
  @ApiProperty() @IsString() title: string;

  @ApiPropertyOptional({ enum: LeadType })
  @IsOptional()
  @IsEnum(LeadType)
  type?: LeadType;

  @ApiPropertyOptional({ description: 'Default: first pipeline stage' })
  @IsOptional()
  @IsUUID()
  stageId?: string;

  @ApiPropertyOptional({ description: 'Default: the stage probability' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  probability?: number;

  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) expectedRevenue?: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() currencyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() expectedCloseDate?: string;

  @ApiPropertyOptional({ enum: LeadSource })
  @IsOptional()
  @IsEnum(LeadSource)
  source?: LeadSource;

  @ApiPropertyOptional({ description: 'Salesperson (default: current user)' })
  @IsOptional()
  @IsUUID()
  assignedUserId?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() contactName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() companyName?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() country?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
}

export class UpdateLeadDto extends PartialType(CreateLeadDto) {}

export class LeadQueryDto {
  @ApiPropertyOptional({ enum: LeadStatus }) @IsOptional() @IsEnum(LeadStatus) status?: LeadStatus;
  @ApiPropertyOptional({ enum: LeadType }) @IsOptional() @IsEnum(LeadType) type?: LeadType;
  @ApiPropertyOptional() @IsOptional() @IsUUID() stageId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() assignedUserId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional({ enum: LeadSource }) @IsOptional() @IsEnum(LeadSource) source?: LeadSource;
  @ApiPropertyOptional({ description: 'Search title, contact, company, email or phone' })
  @IsOptional()
  @IsString()
  search?: string;
}

export class MoveStageDto {
  @ApiProperty() @IsUUID() stageId: string;
}

export class MarkLostDto {
  @ApiProperty() @IsString() reason: string;
}

export class ConvertToCustomerDto {
  @ApiPropertyOptional({ description: 'Link to an existing customer instead of creating one' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ description: 'Customer code (default: generated)' })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() nameAr?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() nameEn?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() taxId?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() paymentTermDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() creditLimit?: number;
}

export class CreateQuotationDto {
  @ApiPropertyOptional({ description: 'Default: today' }) @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() validityDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;

  @ApiProperty({ type: [CreateSalesOrderLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateSalesOrderLineDto)
  lines: CreateSalesOrderLineDto[];
}

// ---------- Activities ----------

export class CreateActivityDto {
  @ApiProperty({ enum: ActivityType }) @IsEnum(ActivityType) type: ActivityType;
  @ApiProperty() @IsString() subject: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiProperty() @IsDateString() dueDate: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() leadId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;

  @ApiPropertyOptional({ description: 'Default: lead salesperson, else current user' })
  @IsOptional()
  @IsUUID()
  assignedUserId?: string;
}

export class UpdateActivityDto extends PartialType(CreateActivityDto) {}

export class CompleteActivityDto {
  @ApiPropertyOptional() @IsOptional() @IsString() result?: string;
}

export const ACTIVITY_STATES = ['planned', 'overdue', 'today', 'done', 'cancelled'] as const;
export type ActivityState = (typeof ACTIVITY_STATES)[number];

export class ActivityQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() leadId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() assignedUserId?: string;

  @ApiPropertyOptional({ enum: ActivityStatus })
  @IsOptional()
  @IsEnum(ActivityStatus)
  status?: ActivityStatus;

  @ApiPropertyOptional({ enum: ACTIVITY_STATES, description: 'Computed state filter' })
  @IsOptional()
  @IsIn(ACTIVITY_STATES as unknown as string[])
  state?: ActivityState;
}

export class MyActivitiesQueryDto {
  @ApiPropertyOptional({ enum: ACTIVITY_STATES })
  @IsOptional()
  @IsIn(ACTIVITY_STATES as unknown as string[])
  state?: ActivityState;
}

// ---------- Reports ----------

export class PipelineReportQueryDto {
  @ApiPropertyOptional({ description: 'Leads created from' }) @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional({ description: 'Leads created to' }) @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() assignedUserId?: string;
}
