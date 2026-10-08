import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Role } from '../entities/role.entity';
import { Permission } from '../entities/permission.entity';
import { RolePermission } from '../entities/role-permission.entity';
import { UserRole } from '../entities/user-role.entity';
import { RbacService } from './rbac.service';
import { CreateRoleDto, PermissionGrantDto, UpdateRoleDto } from '../dto/admin.dto';

/**
 * Roles and their permission grants. A grant is (module, screen?, action?,
 * field?) with an allow/deny effect; omitted parts are wildcards, and deny
 * wins over allow (see RbacService). System roles are superusers and cannot
 * be edited or deleted.
 */
@Injectable()
export class RolesService {
  constructor(
    @InjectRepository(Role)
    private readonly roleRepo: Repository<Role>,
    @InjectRepository(Permission)
    private readonly permissionRepo: Repository<Permission>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepo: Repository<RolePermission>,
    @InjectRepository(UserRole)
    private readonly userRoleRepo: Repository<UserRole>,
    private readonly rbacService: RbacService,
  ) {}

  async findAll(tenantId: string) {
    const roles = await this.roleRepo.find({ where: { tenantId }, order: { name: 'ASC' } });
    return Promise.all(roles.map((r) => this.view(r)));
  }

  async findById(tenantId: string, id: string) {
    return this.view(await this.load(tenantId, id));
  }

  async create(tenantId: string, dto: CreateRoleDto) {
    await this.assertNameFree(tenantId, dto.name);
    const role = await this.roleRepo.save(
      this.roleRepo.create({ tenantId, name: dto.name, description: dto.description }),
    );
    if (dto.permissions?.length) await this.replacePermissions(role, dto.permissions);
    return this.findById(tenantId, role.id);
  }

  async update(tenantId: string, id: string, dto: UpdateRoleDto) {
    const role = await this.loadEditable(tenantId, id);
    if (dto.name && dto.name !== role.name) await this.assertNameFree(tenantId, dto.name);
    Object.assign(role, dto);
    await this.roleRepo.save(role);
    return this.findById(tenantId, id);
  }

  async setPermissions(tenantId: string, id: string, grants: PermissionGrantDto[]) {
    const role = await this.loadEditable(tenantId, id);
    await this.replacePermissions(role, grants);
    return this.findById(tenantId, id);
  }

  async remove(tenantId: string, id: string): Promise<{ message: string }> {
    const role = await this.loadEditable(tenantId, id);
    const users = await this.userRoleRepo.count({ where: { roleId: id } });
    if (users > 0) {
      throw new ConflictException(`The role is assigned to ${users} user(s); unassign it first`);
    }
    await this.rolePermissionRepo.delete({ roleId: id });
    await this.roleRepo.remove(role);
    return { message: 'Role deleted' };
  }

  private async replacePermissions(role: Role, grants: PermissionGrantDto[]) {
    await this.rolePermissionRepo.delete({ roleId: role.id });
    const seen = new Set<string>();
    for (const grant of grants) {
      const key = [grant.module, grant.screen, grant.action, grant.field].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      const permission = await this.findOrCreatePermission(grant);
      await this.rolePermissionRepo.save(
        this.rolePermissionRepo.create({
          roleId: role.id,
          permissionId: permission.id,
          effect: grant.effect ?? 'allow',
        }),
      );
    }
    await this.clearHoldersCache(role);
  }

  /** Permissions are a shared catalogue of (module, screen, action, field) tuples. */
  private async findOrCreatePermission(grant: PermissionGrantDto): Promise<Permission> {
    const where = {
      module: grant.module,
      screen: grant.screen ?? IsNull(),
      action: grant.action ?? IsNull(),
      field: grant.field ?? IsNull(),
    };
    const existing = await this.permissionRepo.findOne({ where });
    if (existing) return existing;
    return this.permissionRepo.save(
      this.permissionRepo.create({
        module: grant.module,
        screen: grant.screen,
        action: grant.action,
        field: grant.field,
      }),
    );
  }

  private async clearHoldersCache(role: Role) {
    const holders = await this.userRoleRepo.find({ where: { roleId: role.id } });
    await Promise.all(holders.map((h) => this.rbacService.clearUserCache(role.tenantId, h.userId)));
  }

  private async assertNameFree(tenantId: string, name: string) {
    if (await this.roleRepo.findOne({ where: { tenantId, name } })) {
      throw new ConflictException(`A role named "${name}" already exists`);
    }
  }

  private async load(tenantId: string, id: string): Promise<Role> {
    const role = await this.roleRepo.findOne({ where: { id, tenantId } });
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  private async loadEditable(tenantId: string, id: string): Promise<Role> {
    const role = await this.load(tenantId, id);
    if (role.isSystemRole) throw new ForbiddenException('System roles cannot be modified');
    return role;
  }

  private async view(role: Role) {
    const grants = await this.rolePermissionRepo.find({
      where: { roleId: role.id },
      relations: ['permission'],
    });
    return {
      id: role.id,
      name: role.name,
      description: role.description,
      isSystemRole: role.isSystemRole,
      userCount: await this.userRoleRepo.count({ where: { roleId: role.id } }),
      permissions: grants.map((g) => ({
        module: g.permission.module,
        screen: g.permission.screen ?? undefined,
        action: g.permission.action ?? undefined,
        field: g.permission.field ?? undefined,
        effect: g.effect as 'allow' | 'deny',
      })),
    };
  }
}
