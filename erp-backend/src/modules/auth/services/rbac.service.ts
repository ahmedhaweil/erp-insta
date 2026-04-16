import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserRole } from '../entities/user-role.entity';
import { RolePermission } from '../entities/role-permission.entity';
import { CacheService } from '@shared/services/cache.service';
import { PermissionRequirement } from '@common/decorators/require-permissions.decorator';

interface CachedPermission {
  module: string;
  screen: string | null;
  action: string | null;
  field: string | null;
  effect: 'allow' | 'deny';
}

@Injectable()
export class RbacService {
  constructor(
    @InjectRepository(UserRole)
    private readonly userRoleRepo: Repository<UserRole>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepo: Repository<RolePermission>,
    private readonly cacheService: CacheService,
  ) {}

  async hasPermission(
    tenantId: string,
    userId: string,
    requirement: PermissionRequirement,
  ): Promise<boolean> {
    const permissions = await this.getUserPermissions(tenantId, userId);

    // Check for explicit deny first
    const denied = permissions.some(
      (p) =>
        p.effect === 'deny' &&
        this.matchesPermission(p, requirement),
    );
    if (denied) return false;

    // Check for allow
    return permissions.some(
      (p) =>
        p.effect === 'allow' &&
        this.matchesPermission(p, requirement),
    );
  }

  async hasAllPermissions(
    tenantId: string,
    userId: string,
    requirements: PermissionRequirement[],
  ): Promise<boolean> {
    for (const req of requirements) {
      if (!(await this.hasPermission(tenantId, userId, req))) {
        return false;
      }
    }
    return true;
  }

  private matchesPermission(
    cached: CachedPermission,
    required: PermissionRequirement,
  ): boolean {
    // Module must match
    if (cached.module !== required.module) return false;

    // If requirement specifies screen, cached must match (or be null = wildcard)
    if (required.screen && cached.screen && cached.screen !== required.screen) {
      return false;
    }

    // If requirement specifies action, cached must match (or be null = wildcard)
    if (required.action && cached.action && cached.action !== required.action) {
      return false;
    }

    // If requirement specifies field, cached must match (or be null = wildcard)
    if (required.field && cached.field && cached.field !== required.field) {
      return false;
    }

    return true;
  }

  private async getUserPermissions(
    tenantId: string,
    userId: string,
  ): Promise<CachedPermission[]> {
    const cacheKey = `rbac:permissions:${userId}`;
    const cached = await this.cacheService.get<CachedPermission[]>(tenantId, cacheKey);
    if (cached) return cached;

    // Get user's active roles
    const userRoles = await this.userRoleRepo.find({
      where: { userId },
    });

    const now = new Date();
    const activeRoleIds = userRoles
      .filter((ur) => {
        if (ur.validFrom && ur.validFrom > now) return false;
        if (ur.validTo && ur.validTo < now) return false;
        return true;
      })
      .map((ur) => ur.roleId);

    if (activeRoleIds.length === 0) return [];

    // Get all permissions for these roles
    const rolePermissions = await this.rolePermissionRepo
      .createQueryBuilder('rp')
      .innerJoinAndSelect('rp.permission', 'p')
      .where('rp.roleId IN (:...roleIds)', { roleIds: activeRoleIds })
      .getMany();

    const permissions: CachedPermission[] = rolePermissions.map((rp) => ({
      module: rp.permission.module,
      screen: rp.permission.screen,
      action: rp.permission.action,
      field: rp.permission.field,
      effect: rp.effect,
    }));

    // Cache for 5 minutes
    await this.cacheService.set(tenantId, cacheKey, permissions, 300);

    return permissions;
  }

  async clearUserCache(tenantId: string, userId: string): Promise<void> {
    await this.cacheService.del(tenantId, `rbac:permissions:${userId}`);
  }
}
