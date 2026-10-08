import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RoleAssignmentDto {
  @ApiProperty()
  @IsUUID()
  roleId: string;

  @ApiPropertyOptional({ description: 'Branches the role applies to; empty = all branches' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  branchIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  validFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  validTo?: string;
}

export class CreateUserDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  password: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ type: [RoleAssignmentDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoleAssignmentDto)
  roles?: RoleAssignmentDto[];
}

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SetUserRolesDto {
  @ApiProperty({ type: [RoleAssignmentDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoleAssignmentDto)
  roles: RoleAssignmentDto[];
}

export class AdminResetPasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(8)
  password: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  currentPassword: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  newPassword: string;
}

export class TwoFaCodeDto {
  @ApiProperty()
  @IsString()
  code: string;
}

export class PermissionGrantDto {
  @ApiProperty({ example: 'sales' })
  @IsString()
  module: string;

  @ApiPropertyOptional({ description: 'Omit for every screen of the module' })
  @IsOptional()
  @IsString()
  screen?: string;

  @ApiPropertyOptional({ description: 'Omit for every action' })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  field?: string;

  @ApiPropertyOptional({ enum: ['allow', 'deny'], default: 'allow' })
  @IsOptional()
  @IsIn(['allow', 'deny'])
  effect?: 'allow' | 'deny';
}

export class CreateRoleDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ type: [PermissionGrantDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PermissionGrantDto)
  permissions?: PermissionGrantDto[];
}

export class UpdateRoleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}

export class SetRolePermissionsDto {
  @ApiProperty({ type: [PermissionGrantDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PermissionGrantDto)
  permissions: PermissionGrantDto[];
}
