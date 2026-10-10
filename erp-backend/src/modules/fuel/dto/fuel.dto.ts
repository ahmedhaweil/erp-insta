import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

export class CreateTankDto {
  @ApiProperty() @IsString() nameAr: string;
  @ApiPropertyOptional() @IsOptional() @IsString() nameEn?: string;
  @ApiProperty() @IsUUID() fuelProductId: string;
  @ApiProperty({ description: 'Dedicated warehouse holding the tank stock' }) @IsUUID() warehouseId: string;
  @ApiProperty() @IsNumber() @Min(0) capacity: number;
  @ApiPropertyOptional({ description: 'Low-level alert threshold (liters)' })
  @IsOptional() @IsNumber() @Min(0) minLevel?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateTankDto extends PartialType(CreateTankDto) {}

export class CreatePumpDto {
  @ApiProperty() @IsString() nameAr: string;
  @ApiPropertyOptional() @IsOptional() @IsString() nameEn?: string;
  @ApiPropertyOptional({ description: 'Station (branch)' }) @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdatePumpDto extends PartialType(CreatePumpDto) {}

export class CreateNozzleDto {
  @ApiProperty() @IsUUID() pumpId: string;
  @ApiProperty() @IsUUID() tankId: string;
  @ApiProperty() @IsString() nameAr: string;
  @ApiPropertyOptional() @IsOptional() @IsString() nameEn?: string;
  @ApiPropertyOptional({ description: 'Initial meter reading' })
  @IsOptional() @IsNumber() @Min(0) currentReading?: number;
  @ApiPropertyOptional({ description: 'Pump price (VAT incl.) overriding the product sales price' })
  @IsOptional() @IsNumber() @Min(0) priceOverride?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

/** The meter is changed through the audited meter adjustment endpoint only. */
export class UpdateNozzleDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() pumpId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() tankId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() nameAr?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() nameEn?: string;
  @ApiPropertyOptional({ nullable: true, description: 'null removes the override' })
  @IsOptional() @IsNumber() @Min(0) priceOverride?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class MeterAdjustmentDto {
  @ApiProperty() @IsNumber() @Min(0) newReading: number;
  @ApiProperty() @IsString() @MinLength(3) reason: string;
}

export class OpenShiftDto {
  @ApiPropertyOptional({ description: 'Station; limits the default nozzles to its pumps' })
  @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional({ description: 'Nozzles worked; defaults to every free active nozzle' })
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) nozzleIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class ClosingReadingDto {
  @ApiProperty() @IsUUID() nozzleId: string;
  @ApiProperty() @IsNumber() @Min(0) closingReading: number;
  @ApiPropertyOptional({ description: 'The meter rolled over or was replaced during the shift' })
  @IsOptional() @IsBoolean() meterReset?: boolean;
  @ApiPropertyOptional({ description: 'Reading at which it rolled over (default: the opening reading, i.e. replaced)' })
  @IsOptional() @IsNumber() @Min(0) rolloverAt?: number;
  @ApiPropertyOptional({ description: 'Coupons / vouchers received on this nozzle' })
  @IsOptional() @IsNumber() @Min(0) couponAmount?: number;
}

export class CreditSaleDto {
  @ApiProperty() @IsUUID() customerId: string;
  @ApiProperty({ description: 'Amount VAT included' }) @IsNumber() @Min(0.01) amount: number;
  @ApiPropertyOptional({ description: 'Nozzle the fuel came from (gives the product and price)' })
  @IsOptional() @IsUUID() nozzleId?: string;
  @ApiPropertyOptional({ description: 'Fuel product; needed when the shift sold several products and no nozzle is given' })
  @IsOptional() @IsUUID() productId?: string;
}

export class CloseShiftDto {
  @ApiProperty({ type: [ClosingReadingDto] })
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ClosingReadingDto)
  readings: ClosingReadingDto[];

  @ApiPropertyOptional({ description: 'Coupons received for the shift as a whole' })
  @IsOptional() @IsNumber() @Min(0) couponAmount?: number;

  @ApiPropertyOptional({ description: 'Card / bank payments' })
  @IsOptional() @IsNumber() @Min(0) cardAmount?: number;

  @ApiPropertyOptional({ type: [CreditSaleDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CreditSaleDto)
  creditSales?: CreditSaleDto[];

  @ApiPropertyOptional({ description: 'Cash counted; defaults to the expected cash' })
  @IsOptional() @IsNumber() @Min(0) cashCounted?: number;

  @ApiPropertyOptional({ description: 'Accounting date, defaults to today' })
  @IsOptional() @IsDateString() date?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class TankDipDto {
  @ApiProperty({ description: 'Measured liters in the tank' }) @IsNumber() @Min(0) measuredQty: number;
  @ApiPropertyOptional({ description: 'Book the variance as a stock adjustment' })
  @IsOptional() @IsBoolean() adjust?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
}

export class FuelPeriodDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
}

export class FuelSalesReportDto extends FuelPeriodDto {
  @ApiPropertyOptional({ enum: ['product', 'nozzle'] })
  @IsOptional() @IsIn(['product', 'nozzle']) groupBy?: 'product' | 'nozzle';
}

export class ShiftQueryDto extends FuelPeriodDto {
  @ApiPropertyOptional({ enum: ['open', 'closed'] }) @IsOptional() @IsIn(['open', 'closed']) status?: 'open' | 'closed';
  @ApiPropertyOptional() @IsOptional() @IsUUID() userId?: string;
}
