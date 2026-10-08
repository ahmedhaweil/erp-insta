import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const TIME = /^\d{1,2}:\d{2}(:\d{2})?$/;

export class UpsertAttendanceDto {
  @ApiProperty() @IsUUID() employeeId: string;
  @ApiProperty() @IsDateString() date: string;

  @ApiPropertyOptional({ example: '09:05' })
  @IsOptional()
  @Matches(TIME)
  checkIn?: string;

  @ApiPropertyOptional({ example: '17:30' })
  @IsOptional()
  @Matches(TIME)
  checkOut?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class ImportAttendanceRowDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() employeeId?: string;
  @ApiPropertyOptional({ description: 'Used when employeeId is omitted (device exports)' })
  @IsOptional()
  @IsString()
  employeeCode?: string;

  @ApiProperty() @IsDateString() date: string;
  @ApiPropertyOptional() @IsOptional() @Matches(TIME) checkIn?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(TIME) checkOut?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class ImportAttendanceDto {
  @ApiProperty({ type: [ImportAttendanceRowDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10000)
  @ValidateNested({ each: true })
  @Type(() => ImportAttendanceRowDto)
  records: ImportAttendanceRowDto[];
}

export class AttendanceQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() employeeId?: string;
  @ApiProperty() @IsDateString() from: string;
  @ApiProperty() @IsDateString() to: string;
}

export class AttendanceSummaryQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() employeeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;
  @ApiProperty() @IsDateString() from: string;
  @ApiProperty() @IsDateString() to: string;
}
