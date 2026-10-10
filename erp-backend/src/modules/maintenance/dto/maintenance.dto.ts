import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { TicketStatus, TicketType } from '../entities/maintenance-ticket.entity';

export class CreateTechnicianDto {
  @ApiProperty() @IsString() nameAr: string;
  @ApiPropertyOptional() @IsOptional() @IsString() nameEn?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() employeeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() userId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateTechnicianDto extends PartialType(CreateTechnicianDto) {}

export class UpdateMaintenanceSettingsDto {
  @ApiPropertyOptional({ description: 'Service product invoiced for labour lines' })
  @IsOptional() @IsUUID() defaultLabourProductId?: string;
  @ApiPropertyOptional({ description: 'Warehouse spare parts are reserved/issued from' })
  @IsOptional() @IsUUID() defaultWarehouseId?: string;
  @ApiPropertyOptional({ description: 'Customer invoiced for walk-in tickets' })
  @IsOptional() @IsUUID() walkInCustomerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() pricesIncludeTax?: boolean;
}

export class CreateTicketDto {
  @ApiPropertyOptional({ description: 'Known customer; omit for a walk-in' })
  @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() customerName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() customerPhone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() customerAddress?: string;
  @ApiPropertyOptional({ enum: TicketType }) @IsOptional() @IsEnum(TicketType) type?: TicketType;
  @ApiProperty() @IsString() deviceName: string;
  @ApiPropertyOptional() @IsOptional() @IsString() brand?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() model?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() serialNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() accessoriesReceived?: string;
  @ApiProperty() @IsString() problem: string;
  @ApiPropertyOptional() @IsOptional() @IsString() diagnosis?: string;
  @ApiPropertyOptional({ description: 'Defaults to today' }) @IsOptional() @IsDateString() receivedDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() promisedDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() appointmentDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() technicianId?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) estimatedCost?: number;
  @ApiPropertyOptional({ description: 'Ceiling agreed with the customer' })
  @IsOptional() @IsNumber() @Min(0) maxApprovedCost?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() customerApproved?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isWarranty?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsDateString() warrantyUntil?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

/** Descriptive fields only: status, approval and lines have their own endpoints. */
export class UpdateTicketDto extends PartialType(
  OmitType(CreateTicketDto, ['maxApprovedCost', 'customerApproved', 'receivedDate'] as const),
) {}

export class ChangeStatusDto {
  @ApiProperty({ enum: TicketStatus }) @IsEnum(TicketStatus) status: TicketStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
}

export class RescheduleDto {
  @ApiProperty() @IsDateString() appointmentDate: string;
  @ApiPropertyOptional({ description: 'Also move the promised date' })
  @IsOptional() @IsDateString() promisedDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
}

export class ApprovalDto {
  @ApiProperty() @IsBoolean() approved: boolean;
  @ApiPropertyOptional({ description: 'New ceiling; null/omitted keeps the current one' })
  @IsOptional() @IsNumber() @Min(0) maxApprovedCost?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
}

export class AddPartDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiProperty() @IsNumber() @Min(0.0001) quantity: number;
  @ApiPropertyOptional({ description: 'Defaults to the product sales price' })
  @IsOptional() @IsNumber() @Min(0) unitPrice?: number;
  @ApiPropertyOptional({ description: 'Defaults to the product sales tax rate' })
  @IsOptional() @IsNumber() @Min(0) @Max(100) taxRate?: number;
  @ApiPropertyOptional({ description: 'Reserve the quantity in the ticket warehouse' })
  @IsOptional() @IsBoolean() reserve?: boolean;
}

export class AddLabourDto {
  @ApiProperty() @IsString() description: string;
  @ApiProperty() @IsNumber() @Min(0) amount: number;
  @ApiPropertyOptional({ description: 'Service product; defaults to the settings labour product' })
  @IsOptional() @IsUUID() serviceProductId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() technicianId?: string;
}

export class InvoiceTicketDto {
  @ApiPropertyOptional({ description: 'Invoice date, defaults to today' })
  @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional({ description: 'Post the invoice right away (default true)' })
  @IsOptional() @IsBoolean() post?: boolean;
}

export class TicketQueryDto {
  @ApiPropertyOptional({ enum: TicketStatus }) @IsOptional() @IsEnum(TicketStatus) status?: TicketStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() technicianId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional({ description: 'Searches number, customer, phone, device and serial' })
  @IsOptional() @IsString() search?: string;
}

export class DateRangeDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
}
