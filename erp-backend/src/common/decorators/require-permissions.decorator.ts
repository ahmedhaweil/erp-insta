import { SetMetadata } from '@nestjs/common';

export interface PermissionRequirement {
  module: string;
  screen?: string;
  action?: string;
  field?: string;
}

export const PERMISSIONS_KEY = 'permissions';

export const RequirePermissions = (...permissions: PermissionRequirement[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
