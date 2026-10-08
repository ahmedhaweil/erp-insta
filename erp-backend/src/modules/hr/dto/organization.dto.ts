import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

export class CreateDepartmentDto {
  @ApiProperty() @IsString() code: string;
  @ApiProperty() @IsString() name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() nameAr?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() parentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() managerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateDepartmentDto extends PartialType(CreateDepartmentDto) {}

export class CreateJobTitleDto {
  @ApiProperty() @IsString() code: string;
  @ApiProperty() @IsString() name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() nameAr?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateJobTitleDto extends PartialType(CreateJobTitleDto) {}

export class CreateWorkScheduleDto {
  @ApiProperty() @IsString() name: string;

  @ApiPropertyOptional({ default: 8 })
  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(24)
  dailyHours?: number;

  @ApiPropertyOptional({ default: '09:00', description: 'HH:mm' })
  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/)
  startTime?: string;

  @ApiPropertyOptional({ type: [Number], description: '0=Sunday ... 6=Saturday', default: [5, 6] })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekendDays?: number[];

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  graceMinutes?: number;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
}
export class UpdateWorkScheduleDto extends PartialType(CreateWorkScheduleDto) {}

export class CreatePublicHolidayDto {
  @ApiProperty() @IsDateString() date: string;
  @ApiProperty() @IsString() name: string;
}

export class UpdateHrSettingsDto {
  @ApiProperty({
    description:
      'Partial override of the payroll rules ({ general, EG, SA }); see GET /hr/settings for the effective values',
  })
  @IsObject()
  rules: Record<string, any>;
}
