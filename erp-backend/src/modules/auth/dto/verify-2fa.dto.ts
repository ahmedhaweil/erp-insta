import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class Verify2faDto {
  @ApiProperty({ description: 'Temporary token from login' })
  @IsString()
  tempToken: string;

  @ApiProperty({ description: 'TOTP code from authenticator app' })
  @IsString()
  code: string;
}
