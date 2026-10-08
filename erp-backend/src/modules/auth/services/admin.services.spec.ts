import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { redact } from './audit.service';
import { UsersService } from './users.service';
import { RolesService } from './roles.service';

jest.mock('bcrypt', () => ({ hash: jest.fn(async () => 'hash'), compare: jest.fn() }));

const repo = () => ({
  find: jest.fn(async (): Promise<any[]> => []),
  findOne: jest.fn<Promise<any>, any[]>(),
  count: jest.fn(async (): Promise<number> => 0),
  save: jest.fn(async (x: any) => (Array.isArray(x) ? x : { id: 'new-id', ...x })),
  create: jest.fn((x: any) => x),
  delete: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
});

describe('redact', () => {
  it('masks credentials at any depth and keeps other fields', () => {
    expect(
      redact({ name: 'A', password: 'p', nested: { clientSecret: 's', list: [{ token: 't', qty: 2 }] } }),
    ).toEqual({
      name: 'A',
      password: '[redacted]',
      nested: { clientSecret: '[redacted]', list: [{ token: '[redacted]', qty: 2 }] },
    });
  });
});

describe('UsersService', () => {
  let users: ReturnType<typeof repo>;
  let userRoles: ReturnType<typeof repo>;
  let roles: ReturnType<typeof repo>;
  let sessions: ReturnType<typeof repo>;
  let rbac: { clearUserCache: jest.Mock };
  let service: UsersService;

  beforeEach(() => {
    users = repo();
    userRoles = repo();
    roles = repo();
    sessions = repo();
    rbac = { clearUserCache: jest.fn() };
    service = new UsersService(users as any, userRoles as any, roles as any, sessions as any, rbac as any);
  });

  it('rejects a duplicate email', async () => {
    users.findOne.mockResolvedValue({ id: 'x' });
    await expect(
      service.create('t1', { name: 'A', email: 'a@b.c', password: '12345678' }),
    ).rejects.toThrow(ConflictException);
  });

  it('refuses roles of another tenant', async () => {
    users.findOne.mockResolvedValueOnce(null);
    roles.count.mockResolvedValue(0);
    await expect(
      service.create('t1', { name: 'A', email: 'a@b.c', password: '12345678', roles: [{ roleId: 'r-other' }] }),
    ).rejects.toThrow(NotFoundException);
  });

  it('prevents users from deactivating themselves', async () => {
    users.findOne.mockResolvedValue({ id: 'u1', tenantId: 't1', userRoles: [] });
    await expect(service.update('t1', 'u1', 'u1', { isActive: false })).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('revokes sessions when a user is deactivated', async () => {
    users.findOne.mockResolvedValue({ id: 'u2', tenantId: 't1', userRoles: [] });
    await service.update('t1', 'u1', 'u2', { isActive: false });
    expect(sessions.update).toHaveBeenCalledWith({ userId: 'u2', revoked: false }, { revoked: true });
    expect(rbac.clearUserCache).toHaveBeenCalledWith('t1', 'u2');
  });

  it('prevents an administrator from removing their own administrator role', async () => {
    users.findOne.mockResolvedValue({ id: 'u1', tenantId: 't1', userRoles: [] });
    userRoles.find.mockResolvedValue([{ role: { isSystemRole: true } }]);
    roles.count.mockResolvedValue(0);
    await expect(service.setRoles('t1', 'u1', 'u1', [{ roleId: 'r-basic' }])).rejects.toThrow(
      ForbiddenException,
    );
  });
});

describe('RolesService', () => {
  let roles: ReturnType<typeof repo>;
  let permissions: ReturnType<typeof repo>;
  let rolePermissions: ReturnType<typeof repo>;
  let userRoles: ReturnType<typeof repo>;
  let service: RolesService;

  beforeEach(() => {
    roles = repo();
    permissions = repo();
    rolePermissions = repo();
    userRoles = repo();
    service = new RolesService(
      roles as any,
      permissions as any,
      rolePermissions as any,
      userRoles as any,
      { clearUserCache: jest.fn() } as any,
    );
  });

  it('does not allow editing system roles', async () => {
    roles.findOne.mockResolvedValue({ id: 'r1', tenantId: 't1', isSystemRole: true });
    await expect(service.setPermissions('t1', 'r1', [])).rejects.toThrow(ForbiddenException);
  });

  it('does not delete a role that is still assigned', async () => {
    roles.findOne.mockResolvedValue({ id: 'r1', tenantId: 't1', isSystemRole: false });
    userRoles.count.mockResolvedValue(2);
    await expect(service.remove('t1', 'r1')).rejects.toThrow(ConflictException);
  });

  it('reuses catalogue permissions and stores the grant effect', async () => {
    roles.findOne.mockResolvedValue({ id: 'r1', tenantId: 't1', name: 'Clerk', isSystemRole: false });
    permissions.findOne.mockResolvedValueOnce({ id: 'p-existing' }).mockResolvedValueOnce(null);
    permissions.save.mockResolvedValue({ id: 'p-new' });
    await service.setPermissions('t1', 'r1', [
      { module: 'sales', screen: 'orders', action: 'read' },
      { module: 'sales', screen: 'invoices', action: 'delete', effect: 'deny' },
    ]);
    expect(rolePermissions.delete).toHaveBeenCalledWith({ roleId: 'r1' });
    expect(rolePermissions.save).toHaveBeenCalledWith(
      expect.objectContaining({ permissionId: 'p-existing', effect: 'allow' }),
    );
    expect(rolePermissions.save).toHaveBeenCalledWith(
      expect.objectContaining({ permissionId: 'p-new', effect: 'deny' }),
    );
  });
});
