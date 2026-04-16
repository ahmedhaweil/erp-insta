import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Inject, Optional } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { Reflector } from '@nestjs/core';
import { CacheService } from '@shared/services/cache.service';
import { TenantsService } from '@modules/tenants/services/tenants.service';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @Optional() @Inject(TenantsService) private readonly tenantsService: TenantsService,
    @Optional() @Inject(CacheService) private readonly cacheService: CacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user?.tenantId) {
      throw new ForbiddenException('No tenant context');
    }

    if (!this.tenantsService) return true;

    // Check cache first
    const cacheKey = `tenant:active:${user.tenantId}`;
    if (this.cacheService) {
      const cached = await this.cacheService.get<boolean>(user.tenantId, cacheKey);
      if (cached === false) {
        throw new ForbiddenException('Tenant account is suspended');
      }
      if (cached === true) return true;
    }

    // Check DB
    try {
      const tenant = await this.tenantsService.findById(user.tenantId);
      const isActive = tenant.isActive;

      // Cache for 60 seconds
      if (this.cacheService) {
        await this.cacheService.set(user.tenantId, cacheKey, isActive, 60);
      }

      if (!isActive) {
        throw new ForbiddenException('Tenant account is suspended');
      }
    } catch (err) {
      if (err instanceof ForbiddenException) throw err;
      // Tenant not found or DB error - deny access
      throw new ForbiddenException('Invalid tenant');
    }

    return true;
  }
}
