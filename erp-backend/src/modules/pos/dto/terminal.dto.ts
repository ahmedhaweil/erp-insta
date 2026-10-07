import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTerminalDto {
  @ApiProperty() @IsUUID() branchId: string;
  @ApiProperty() @IsString() name: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() warehouseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() printerIp?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cashDrawerPort?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() scalePort?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class RefundPosOrderDto {
  @ApiProperty({ description: 'Open session the refund is paid from' })
  @IsUUID()
  sessionId: string;
}
