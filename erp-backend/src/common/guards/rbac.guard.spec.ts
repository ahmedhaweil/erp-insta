import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RbacGuard } from './rbac.guard';
import { RbacService } from '@modules/auth/services/rbac.service';

describe('RbacGuard', () => {
  let guard: RbacGuard;
  let reflector: Record<string, jest.Mock>;
  let rbacService: Partial<RbacService>;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    };
    rbacService = {
      hasAllPermissions: jest.fn().mockResolvedValue(true),
    };
    guard = new RbacGuard(
      reflector as unknown as Reflector,
      rbacService as RbacService,
    );
  });

  const createMockContext = (user?: any): ExecutionContext =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    }) as unknown as ExecutionContext;

  it('should allow access for public routes', async () => {
    reflector.getAllAndOverride.mockReturnValueOnce(true);

    const result = await guard.canActivate(createMockContext());

    expect(result).toBe(true);
  });

  it('should allow access when no permissions are required', async () => {
    reflector.getAllAndOverride
      .mockReturnValueOnce(false) // isPublic
      .mockReturnValueOnce(null); // permissions

    const result = await guard.canActivate(createMockContext({ sub: 'user-1' }));

    expect(result).toBe(true);
  });

  it('should allow access when permissions list is empty', async () => {
    reflector.getAllAndOverride
      .mockReturnValueOnce(false)
      .mockReturnValueOnce([]);

    const result = await guard.canActivate(createMockContext({ sub: 'user-1' }));

    expect(result).toBe(true);
  });

  it('should throw ForbiddenException when no user context and permissions required', async () => {
    reflector.getAllAndOverride
      .mockReturnValueOnce(false)
      .mockReturnValueOnce([{ module: 'accounting', action: 'read' }]);

    await expect(guard.canActivate(createMockContext(null))).rejects.toThrow(ForbiddenException);
  });

  it('should allow when rbac service confirms permissions', async () => {
    reflector.getAllAndOverride
      .mockReturnValueOnce(false)
      .mockReturnValueOnce([{ module: 'accounting', action: 'read' }]);

    const result = await guard.canActivate(
      createMockContext({ sub: 'user-1', tenantId: 'tenant-1', roles: ['admin'] }),
    );

    expect(result).toBe(true);
    expect(rbacService.hasAllPermissions).toHaveBeenCalledWith(
      'tenant-1', 'user-1', [{ module: 'accounting', action: 'read' }],
    );
  });

  it('should throw ForbiddenException when rbac service denies permissions', async () => {
    (rbacService.hasAllPermissions as jest.Mock).mockResolvedValue(false);
    reflector.getAllAndOverride
      .mockReturnValueOnce(false)
      .mockReturnValueOnce([{ module: 'accounting', action: 'write' }]);

    await expect(
      guard.canActivate(
        createMockContext({ sub: 'user-1', tenantId: 'tenant-1', roles: ['viewer'] }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should allow when rbacService is null (graceful degradation)', async () => {
    const guardWithoutRbac = new RbacGuard(reflector as unknown as Reflector, undefined as any);
    reflector.getAllAndOverride
      .mockReturnValueOnce(false)
      .mockReturnValueOnce([{ module: 'accounting', action: 'read' }]);

    const result = await guardWithoutRbac.canActivate(
      createMockContext({ sub: 'user-1', tenantId: 'tenant-1' }),
    );

    expect(result).toBe(true);
  });
});
