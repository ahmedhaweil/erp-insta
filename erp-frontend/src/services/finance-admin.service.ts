import api from '@/lib/api';

/** Administration: users, roles, permissions, audit log, profile, company and branches. */

const d = <T>(p: Promise<{ data: { data: T } }>) => p.then((r) => r.data.data);

export interface RoleAssignment {
  roleId: string;
  name?: string;
  branchIds?: string[];
  validFrom?: string | null;
  validTo?: string | null;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  lastLogin: string | null;
  twoFaEnabled: boolean;
  createdAt: string;
  roles: RoleAssignment[];
}

export interface PermissionGrant {
  module: string;
  screen?: string;
  action?: string;
  field?: string;
  effect?: 'allow' | 'deny';
}

export interface Role {
  id: string;
  name: string;
  description: string | null;
  isSystemRole: boolean;
  userCount: number;
  permissions: PermissionGrant[];
}

export interface PermissionCatalogModule {
  module: string;
  screens: { screen: string; actions: string[] }[];
}

export interface AuditLog {
  id: string;
  createdAt: string;
  userId: string;
  action: string;
  module: string;
  recordType: string;
  recordId: string | null;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface TenantInfo {
  id: string;
  slug: string;
  name: string;
  plan: string;
  domain: string | null;
  country: string | null;
  taxId: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  isActive: boolean;
  settings: Record<string, any> | null;
}

export interface Branch {
  id: string;
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  isActive: boolean;
}

export const adminService = {
  // users
  getUsers: () => d<AdminUser[]>(api.get('/users')),
  createUser: (data: { name: string; email: string; password: string; phone?: string; roles?: RoleAssignment[] }) =>
    d<AdminUser>(api.post('/users', data)),
  updateUser: (id: string, data: { name?: string; phone?: string; isActive?: boolean }) =>
    d<AdminUser>(api.patch(`/users/${id}`, data)),
  setUserRoles: (id: string, roles: RoleAssignment[]) => d<AdminUser>(api.put(`/users/${id}/roles`, { roles })),
  resetUserPassword: (id: string, password: string) =>
    d<unknown>(api.post(`/users/${id}/reset-password`, { password })),

  // roles
  getRoles: () => d<Role[]>(api.get('/roles')),
  getPermissionCatalog: () => d<PermissionCatalogModule[]>(api.get('/roles/permissions/catalog')),
  createRole: (data: { name: string; description?: string; permissions?: PermissionGrant[] }) =>
    d<Role>(api.post('/roles', data)),
  updateRole: (id: string, data: { name?: string; description?: string }) => d<Role>(api.patch(`/roles/${id}`, data)),
  setRolePermissions: (id: string, permissions: PermissionGrant[]) =>
    d<Role>(api.put(`/roles/${id}/permissions`, { permissions })),
  deleteRole: (id: string) => d<unknown>(api.delete(`/roles/${id}`)),

  // audit
  getAuditLogs: (params: { userId?: string; module?: string; recordId?: string; from?: string; to?: string; limit?: number }) =>
    d<AuditLog[]>(api.get('/audit-logs', { params: clean(params) })),

  // profile
  getMe: () => d<AdminUser>(api.get('/auth/me')),
  changePassword: (currentPassword: string, newPassword: string) =>
    d<unknown>(api.post('/auth/change-password', { currentPassword, newPassword })),
  setupTwoFa: () => d<{ secret: string; otpauthUrl: string }>(api.post('/auth/2fa/setup')),
  enableTwoFa: (code: string) => d<unknown>(api.post('/auth/2fa/enable', { code })),
  disableTwoFa: (code: string) => d<unknown>(api.post('/auth/2fa/disable', { code })),

  // company
  getCurrentTenant: () => d<TenantInfo>(api.get('/tenants/current')),
  updateTenant: (id: string, data: Partial<TenantInfo>) => d<TenantInfo>(api.patch(`/tenants/${id}`, data)),

  // branches
  getBranches: () => d<Branch[]>(api.get('/branches')),
  createBranch: (data: { code: string; name: string; address?: string; phone?: string; isActive?: boolean }) =>
    d<Branch>(api.post('/branches', data)),
  updateBranch: (id: string, data: Record<string, unknown>) => d<Branch>(api.patch(`/branches/${id}`, data)),
};

/** Drops empty values from a query object. */
export function clean<T extends Record<string, unknown>>(params: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out as Partial<T>;
}
