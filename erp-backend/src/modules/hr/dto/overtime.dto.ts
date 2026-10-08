import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { OvertimeRequestStatus } from '../entities/overtime-request.entity';

export class CreateOvertimeRequestDto {
  @ApiProperty() @IsUUID() employeeId: string;
  @ApiProperty() @IsDateString() date: string;
  @ApiProperty() @IsNumber() @Min(0.25) @Max(24) hours: number;
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
}

export class MyOvertimeRequestDto extends OmitType(CreateOvertimeRequestDto, ['employeeId'] as const) {}

export class OvertimeQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() employeeId?: string;
  @ApiPropertyOptional({ enum: OvertimeRequestStatus })
  @IsOptional()
  @IsEnum(OvertimeRequestStatus)
  status?: OvertimeRequestStatus;
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
}
