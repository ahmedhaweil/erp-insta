import { IsNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CloseSessionDto {
  @ApiProperty()
  @IsNumber()
  closingCash: number;
}
