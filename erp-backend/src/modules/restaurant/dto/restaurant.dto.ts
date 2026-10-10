import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { DriverCommissionBasis } from '../entities/master-data.entity';
import { ModifierType } from '../entities/menu.entity';
import { TicketNumberReset } from '../entities/restaurant-settings.entity';
import { KitchenTicketStatus, TicketOrderType, TicketStatus } from '../entities/ticket.entity';
import { PosPaymentMethod } from '@modules/pos/entities/pos-order.entity';

class NamedDto {
  @ApiProperty() @IsString() @IsNotEmpty() nameAr: string;
  @ApiPropertyOptional() @IsOptional() @IsString() nameEn?: string;
}

// ---------------------------------------------------------------- master data

export class CreateDiningAreaDto extends NamedDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateDiningAreaDto extends PartialType(CreateDiningAreaDto) {}

export class CreateTableDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(50) name: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() areaId?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) seats?: number;
  @ApiPropertyOptional({ description: 'Minimum spend (net of tax) on dine-in' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minimumCharge?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateTableDto extends PartialType(CreateTableDto) {}

export class CreateZoneDto extends NamedDto {
  @ApiProperty() @IsNumber() @Min(0) fee: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateZoneDto extends PartialType(CreateZoneDto) {}

export class CreateDriverDto extends NamedDto {
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(100) commissionPercent?: number;
  @ApiPropertyOptional({ enum: DriverCommissionBasis })
  @IsOptional()
  @IsEnum(DriverCommissionBasis)
  commissionBasis?: DriverCommissionBasis;
  @ApiPropertyOptional() @IsOptional() @IsUUID() employeeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateDriverDto extends PartialType(CreateDriverDto) {}

export class CreateDeliveryAppDto extends NamedDto {
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(100) commissionPercent?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateDeliveryAppDto extends PartialType(CreateDeliveryAppDto) {}

export class AppPriceDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiProperty() @IsNumber() @Min(0) price: number;
}

export class SetAppPricesDto {
  @ApiProperty({ type: [AppPriceDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AppPriceDto)
  prices: AppPriceDto[];
}

export class CreateStationDto extends NamedDto {
  @ApiPropertyOptional() @IsOptional() @IsString() printerName?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateStationDto extends PartialType(CreateStationDto) {}

export class SetRoutesDto {
  @ApiPropertyOptional({ description: 'Route a product (overrides its category)' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ description: 'Route a whole category' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiProperty({ type: [String], description: 'Stations; empty removes the routing' })
  @IsArray()
  @IsUUID('all', { each: true })
  stationIds: string[];
}

export class CreateModifierDto extends NamedDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiProperty({ enum: ModifierType }) @IsEnum(ModifierType) type: ModifierType;
  @ApiPropertyOptional({ description: 'Addon: price added; without: price reduction (>= 0)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;
  @ApiPropertyOptional({ description: 'Addon: stock product consumed' })
  @IsOptional()
  @IsUUID()
  stockProductId?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) stockQuantity?: number;
  @ApiPropertyOptional({ description: 'Without: ingredient left out' })
  @IsOptional()
  @IsUUID()
  ingredientProductId?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateModifierDto extends PartialType(CreateModifierDto) {}

export class ComboItemDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) extraPrice?: number;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsNumber() @IsPositive() quantity?: number;
}

export class CreateComboGroupDto extends NamedDto {
  @ApiProperty() @IsUUID() comboProductId: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsInt() @Min(0) minPicks?: number;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsInt() @Min(1) maxPicks?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() sortOrder?: number;
  @ApiProperty({ type: [ComboItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ComboItemDto)
  items: ComboItemDto[];
}
export class UpdateComboGroupDto extends PartialType(CreateComboGroupDto) {}

export class UpdateRestaurantSettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(100) serviceChargePercent?: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() serviceChargeProductId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() deliveryFeeProductId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requireTableForDineIn?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) kdsYellowMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) kdsOrangeMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) kdsRedMinutes?: number;
  @ApiPropertyOptional({ enum: TicketNumberReset })
  @IsOptional()
  @IsEnum(TicketNumberReset)
  ticketNumberReset?: TicketNumberReset;
}

// ---------------------------------------------------------------- tickets

export class ComboPickDto {
  @ApiProperty() @IsUUID() groupId: string;
  @ApiProperty() @IsUUID() productId: string;
}

export class AddTicketLineDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiProperty() @IsNumber() @IsPositive() quantity: number;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  modifierIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(250) note?: string;
  @ApiPropertyOptional({ type: [ComboPickDto], description: 'Choices when the product is a combo' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ComboPickDto)
  comboPicks?: ComboPickDto[];
  @ApiPropertyOptional({ description: 'Line discount amount (needs restaurant/tickets/discount)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number;
}

export class CreateTicketDto {
  @ApiProperty({ enum: TicketOrderType }) @IsEnum(TicketOrderType) orderType: TicketOrderType;
  @ApiPropertyOptional() @IsOptional() @IsUUID() tableId?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) guests?: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() customerPhone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() deliveryAddress?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() zoneId?: string;
  @ApiPropertyOptional({ description: 'Defaults to the zone fee' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  deliveryFee?: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() driverId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() deliveryAppId?: string;
  @ApiPropertyOptional({ description: 'Required with deliveryAppId' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  appReference?: string;
  @ApiPropertyOptional({ description: 'POS session the ticket is opened in' })
  @IsOptional()
  @IsUUID()
  sessionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional({ type: [AddTicketLineDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddTicketLineDto)
  lines?: AddTicketLineDto[];
}

export class UpdateTicketDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) guests?: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() customerPhone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() deliveryAddress?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() zoneId?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) deliveryFee?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) appReference?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional({ description: 'Invoice discount amount (needs restaurant/tickets/discount)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  invoiceDiscount?: number;
}

export class UpdateTicketLineDto {
  @ApiPropertyOptional() @IsOptional() @IsNumber() @IsPositive() quantity?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(250) note?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) discount?: number;
  @ApiPropertyOptional({ description: 'Required when reducing below the quantity sent to the kitchen' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class ReasonDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(250) reason?: string;
}

export class VoidTicketDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(250) reason: string;
}

export class TransferTicketDto {
  @ApiProperty() @IsUUID() tableId: string;
}

export class MergeTicketDto {
  @ApiProperty({ description: 'Ticket receiving the lines of this ticket' })
  @IsUUID()
  targetTicketId: string;
}

export class SplitLineDto {
  @ApiProperty() @IsUUID() lineId: string;
  @ApiProperty() @IsNumber() @IsPositive() quantity: number;
}

export class SplitTicketDto {
  @ApiProperty({ type: [SplitLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SplitLineDto)
  lines: SplitLineDto[];
}

export class AssignDriverDto {
  @ApiPropertyOptional({ description: 'Null to unassign' })
  @IsOptional()
  @IsUUID()
  driverId?: string | null;
}

export class PayTicketDto {
  @ApiProperty() @IsUUID() sessionId: string;
  @ApiProperty({ enum: PosPaymentMethod }) @IsEnum(PosPaymentMethod) paymentMethod: PosPaymentMethod;
  @ApiPropertyOptional({ description: 'Cash part of a split payment (rest is card)' })
  @IsOptional()
  @IsNumber()
  cashAmount?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() cashReceived?: number;
}

export class TicketQueryDto {
  @ApiPropertyOptional({ enum: TicketStatus }) @IsOptional() @IsEnum(TicketStatus) status?: TicketStatus;
  @ApiPropertyOptional({ enum: TicketOrderType })
  @IsOptional()
  @IsEnum(TicketOrderType)
  orderType?: TicketOrderType;
  @ApiPropertyOptional() @IsOptional() @IsUUID() tableId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() driverId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
}

// ---------------------------------------------------------------- kitchen & reports

export class KdsQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() stationId?: string;
}

export class KitchenStatusDto {
  @ApiProperty({ enum: [KitchenTicketStatus.PREPARING, KitchenTicketStatus.READY, KitchenTicketStatus.SERVED, KitchenTicketStatus.CANCELLED] })
  @IsIn([KitchenTicketStatus.PREPARING, KitchenTicketStatus.READY, KitchenTicketStatus.SERVED, KitchenTicketStatus.CANCELLED])
  status: KitchenTicketStatus;
}

export class PeriodQueryDto {
  @ApiProperty() @IsDateString() from: string;
  @ApiProperty() @IsDateString() to: string;
}

export class DriverReportQueryDto extends PeriodQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() driverId?: string;
}

export class VoidLogQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() userId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() ticketId?: string;
}

export class SplitPreviewQueryDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(2) @Max(50) ways: number;
}
