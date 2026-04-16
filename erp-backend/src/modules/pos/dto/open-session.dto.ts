import { IsUUID, IsNumber, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class OpenSessionDto {
  @ApiProperty()
  @IsUUID()
  terminalId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  openingCash?: number;
}
