import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RbacGuard } from './rbac.guard';

describe('RbacGuard', () => {
  let guard: RbacGuard;
  let reflector: Record<string, jest.Mock>;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    };
    guard = new RbacGuard(reflector as unknown as Reflector);
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
      .mockReturnValueOnce([{ resource: 'accounts', action: 'read' }]);

    await expect(guard.canActivate(createMockContext(null))).rejects.toThrow(ForbiddenException);
  });

  it('should allow authenticated users when permissions are required (current implementation)', async () => {
    reflector.getAllAndOverride
      .mockReturnValueOnce(false)
      .mockReturnValueOnce([{ resource: 'accounts', action: 'read' }]);

    const result = await guard.canActivate(
      createMockContext({ sub: 'user-1', roles: ['admin'] }),
    );

    expect(result).toBe(true);
  });
});
