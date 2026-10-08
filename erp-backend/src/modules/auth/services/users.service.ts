import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { authenticator } from 'otplib';
import { User } from '../entities/user.entity';
import { UserRole } from '../entities/user-role.entity';
import { Role } from '../entities/role.entity';
import { Session } from '../entities/session.entity';
import { RbacService } from './rbac.service';
import {
  CreateUserDto,
  RoleAssignmentDto,
  UpdateUserDto,
} from '../dto/admin.dto';

/** User as returned by the API: never exposes hashes, secrets or reset tokens. */
export type PublicUser = Pick<
  User,
  'id' | 'name' | 'email' | 'phone' | 'isActive' | 'lastLogin' | 'twoFaEnabled' | 'createdAt'
> & {
  roles: { roleId: string; name: string; branchIds: string[]; validFrom: Date; validTo: Date }[];
};

/**
 * Tenant user administration: creating users, activating/deactivating them,
 * assigning roles (optionally limited to branches and validity dates),
 * password resets and two-factor enrolment.
 */
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserRole)
    private readonly userRoleRepo: Repository<UserRole>,
    @InjectRepository(Role)
    private readonly roleRepo: Repository<Role>,
    @InjectRepository(Session)
    private readonly sessionRepo: Repository<Session>,
    private readonly rbacService: RbacService,
  ) {}

  async findAll(tenantId: string): Promise<PublicUser[]> {
    const users = await this.userRepo.find({
      where: { tenantId },
      relations: ['userRoles', 'userRoles.role'],
      order: { name: 'ASC' },
    });
    return users.map((u) => this.toPublic(u));
  }

  async findById(tenantId: string, id: string): Promise<PublicUser> {
    return this.toPublic(await this.load(tenantId, id));
  }

  async create(tenantId: string, dto: CreateUserDto): Promise<PublicUser> {
    // Emails are globally unique (login resolves tenant by slug, then email)
    const existing = await this.userRepo.findOne({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already registered');

    const user = await this.userRepo.save(
      this.userRepo.create({
        tenantId,
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        passwordHash: await bcrypt.hash(dto.password, 12),
        isActive: true,
      }),
    );
    if (dto.roles?.length) await this.replaceRoles(tenantId, user.id, dto.roles);
    return this.findById(tenantId, user.id);
  }

  async update(
    tenantId: string,
    actorId: string,
    id: string,
    dto: UpdateUserDto,
  ): Promise<PublicUser> {
    const user = await this.load(tenantId, id);
    if (dto.isActive === false && id === actorId) {
      throw new ForbiddenException('You cannot deactivate your own account');
    }
    Object.assign(user, dto);
    await this.userRepo.save(user);
    if (dto.isActive === false) await this.revokeSessions(id);
    await this.rbacService.clearUserCache(tenantId, id);
    return this.findById(tenantId, id);
  }

  async setRoles(
    tenantId: string,
    actorId: string,
    id: string,
    roles: RoleAssignmentDto[],
  ): Promise<PublicUser> {
    await this.load(tenantId, id);
    if (id === actorId) {
      const current = await this.userRoleRepo.find({ where: { userId: id }, relations: ['role'] });
      const hadSystemRole = current.some((ur) => ur.role?.isSystemRole);
      const keepsSystemRole = await this.roleRepo.count({
        where: { tenantId, id: In(roles.map((r) => r.roleId)), isSystemRole: true },
      });
      if (hadSystemRole && !keepsSystemRole) {
        throw new ForbiddenException('You cannot remove your own administrator role');
      }
    }
    await this.replaceRoles(tenantId, id, roles);
    return this.findById(tenantId, id);
  }

  async resetPassword(tenantId: string, id: string, password: string): Promise<{ message: string }> {
    const user = await this.load(tenantId, id);
    user.passwordHash = await bcrypt.hash(password, 12);
    user.failedAttempts = 0;
    user.lockedUntil = null as any;
    await this.userRepo.save(user);
    await this.revokeSessions(id);
    return { message: 'Password reset; the user must sign in again' };
  }

  async changeOwnPassword(
    tenantId: string,
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const user = await this.load(tenantId, userId);
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    user.passwordHash = await bcrypt.hash(newPassword, 12);
    await this.userRepo.save(user);
    await this.revokeSessions(userId);
    return { message: 'Password changed; other sessions were signed out' };
  }

  /** Starts 2FA enrolment: stores a new secret (not yet enabled) and returns the otpauth URL. */
  async setupTwoFa(tenantId: string, userId: string): Promise<{ secret: string; otpauthUrl: string }> {
    const user = await this.load(tenantId, userId);
    if (user.twoFaEnabled) throw new ConflictException('Two-factor authentication is already enabled');
    const secret = authenticator.generateSecret();
    user.twoFaSecret = secret;
    await this.userRepo.save(user);
    return { secret, otpauthUrl: authenticator.keyuri(user.email, 'ERP', secret) };
  }

  async enableTwoFa(tenantId: string, userId: string, code: string): Promise<{ message: string }> {
    const user = await this.load(tenantId, userId);
    if (!user.twoFaSecret) throw new BadRequestException('Start the two-factor setup first');
    if (!authenticator.verify({ token: code, secret: user.twoFaSecret })) {
      throw new UnauthorizedException('Invalid 2FA code');
    }
    user.twoFaEnabled = true;
    await this.userRepo.save(user);
    return { message: 'Two-factor authentication enabled' };
  }

  async disableTwoFa(tenantId: string, userId: string, code: string): Promise<{ message: string }> {
    const user = await this.load(tenantId, userId);
    if (!user.twoFaEnabled) throw new ConflictException('Two-factor authentication is not enabled');
    if (!authenticator.verify({ token: code, secret: user.twoFaSecret })) {
      throw new UnauthorizedException('Invalid 2FA code');
    }
    user.twoFaEnabled = false;
    user.twoFaSecret = null as any;
    await this.userRepo.save(user);
    return { message: 'Two-factor authentication disabled' };
  }

  private async replaceRoles(tenantId: string, userId: string, roles: RoleAssignmentDto[]) {
    const roleIds = [...new Set(roles.map((r) => r.roleId))];
    if (roleIds.length !== roles.length) throw new BadRequestException('A role is assigned twice');
    if (roleIds.length) {
      const found = await this.roleRepo.count({ where: { tenantId, id: In(roleIds) } });
      if (found !== roleIds.length) throw new NotFoundException('One or more roles do not exist');
    }
    await this.userRoleRepo.delete({ userId });
    if (roles.length) {
      await this.userRoleRepo.save(
        roles.map((r) =>
          this.userRoleRepo.create({
            userId,
            roleId: r.roleId,
            branchIds: r.branchIds ?? [],
            validFrom: r.validFrom ? new Date(r.validFrom) : (null as any),
            validTo: r.validTo ? new Date(r.validTo) : (null as any),
          }),
        ),
      );
    }
    await this.rbacService.clearUserCache(tenantId, userId);
  }

  private async revokeSessions(userId: string) {
    await this.sessionRepo.update({ userId, revoked: false }, { revoked: true });
  }

  private async load(tenantId: string, id: string): Promise<User> {
    const user = await this.userRepo.findOne({
      where: { id, tenantId },
      relations: ['userRoles', 'userRoles.role'],
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private toPublic(user: User): PublicUser {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      isActive: user.isActive,
      lastLogin: user.lastLogin,
      twoFaEnabled: user.twoFaEnabled,
      createdAt: user.createdAt,
      roles: (user.userRoles ?? []).map((ur) => ({
        roleId: ur.roleId,
        name: ur.role?.name,
        branchIds: ur.branchIds ?? [],
        validFrom: ur.validFrom,
        validTo: ur.validTo,
      })),
    };
  }
}
