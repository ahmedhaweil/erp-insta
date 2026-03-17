import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class IdParamDto {
  @ApiProperty({ description: 'UUID of the resource' })
  @IsUUID()
  id: string;
}
