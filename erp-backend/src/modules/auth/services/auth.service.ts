import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { authenticator } from 'otplib';
import { User } from '../entities/user.entity';
import { Session } from '../entities/session.entity';
import { UserRole } from '../entities/user-role.entity';
import { TenantsService } from '@modules/tenants/services/tenants.service';
import { LoginDto } from '../dto/login.dto';
import { RegisterUserDto } from '../dto/register-user.dto';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Session)
    private readonly sessionRepo: Repository<Session>,
    @InjectRepository(UserRole)
    private readonly userRoleRepo: Repository<UserRole>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly tenantsService: TenantsService,
  ) {}

  async login(dto: LoginDto, ip?: string, device?: string) {
    // Resolve tenant
    const tenant = await this.tenantsService.findBySlug(dto.tenantSlug);
    if (!tenant.isActive) {
      throw new ForbiddenException('Tenant account is suspended');
    }

    // Find user
    const user = await this.userRepo.findOne({
      where: { email: dto.email, tenantId: tenant.id },
      relations: ['userRoles', 'userRoles.role'],
    });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check locked
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ForbiddenException('Account is temporarily locked');
    }

    // Verify password
    const isValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isValid) {
      user.failedAttempts += 1;
      if (user.failedAttempts >= 5) {
        user.lockedUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 min lock
      }
      await this.userRepo.save(user);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Reset failed attempts
    user.failedAttempts = 0;
    user.lockedUntil = null as any;
    user.lastLogin = new Date();
    await this.userRepo.save(user);

    // Check 2FA
    if (user.twoFaEnabled) {
      const tempToken = this.jwtService.sign(
        { sub: user.id, tenantId: tenant.id, requires2fa: true },
        { expiresIn: '5m' },
      );
      return { requires2fa: true, tempToken };
    }

    return this.generateTokens(user, tenant.id, ip, device);
  }

  async verify2fa(tempToken: string, code: string, ip?: string, device?: string) {
    const payload = this.jwtService.verify(tempToken);
    if (!payload.requires2fa) {
      throw new UnauthorizedException('Invalid 2FA token');
    }

    const user = await this.userRepo.findOne({
      where: { id: payload.sub },
      relations: ['userRoles', 'userRoles.role'],
    });
    if (!user) throw new UnauthorizedException('User not found');

    const isValid = authenticator.verify({ token: code, secret: user.twoFaSecret });
    if (!isValid) {
      throw new UnauthorizedException('Invalid 2FA code');
    }

    return this.generateTokens(user, payload.tenantId, ip, device);
  }

  async refreshToken(refreshToken: string, ip?: string) {
    const payload = this.jwtService.verify(refreshToken, {
      secret: this.configService.get('jwt.refreshSecret'),
    });

    const tokenHash = await bcrypt.hash(refreshToken, 10);
    const session = await this.sessionRepo.findOne({
      where: { userId: payload.sub, revoked: false },
    });

    if (!session) {
      throw new UnauthorizedException('Session not found or revoked');
    }

    const user = await this.userRepo.findOne({
      where: { id: payload.sub },
      relations: ['userRoles', 'userRoles.role'],
    });
    if (!user) throw new UnauthorizedException('User not found');

    // Revoke old session
    session.revoked = true;
    await this.sessionRepo.save(session);

    return this.generateTokens(user, payload.tenantId, ip);
  }

  async logout(userId: string): Promise<void> {
    await this.sessionRepo.update({ userId, revoked: false }, { revoked: true });
  }

  async forgotPassword(email: string, tenantSlug: string): Promise<{ message: string }> {
    const tenant = await this.tenantsService.findBySlug(tenantSlug);
    const user = await this.userRepo.findOne({
      where: { email, tenantId: tenant.id },
    });

    // Always return success to prevent email enumeration
    if (!user) {
      return { message: 'If the email exists, a reset link has been sent' };
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = await bcrypt.hash(resetToken, 10);

    user.resetToken = tokenHash;
    user.resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await this.userRepo.save(user);

    // TODO: Send email with reset link containing resetToken
    // For now, return the token in response (dev only)
    return {
      message: 'If the email exists, a reset link has been sent',
      // Include token for development/testing purposes
      ...(this.configService.get('app.env') === 'development' ? { resetToken } : {}),
    } as any;
  }

  async resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
    // Find users with non-expired reset tokens
    const users = await this.userRepo
      .createQueryBuilder('user')
      .where('user.resetTokenExpiry > :now', { now: new Date() })
      .andWhere('user.resetToken IS NOT NULL')
      .getMany();

    // Verify token against hashes
    let matchedUser: User | null = null;
    for (const user of users) {
      const isValid = await bcrypt.compare(token, user.resetToken);
      if (isValid) {
        matchedUser = user;
        break;
      }
    }

    if (!matchedUser) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    matchedUser.passwordHash = await bcrypt.hash(newPassword, 12);
    matchedUser.resetToken = null as any;
    matchedUser.resetTokenExpiry = null as any;
    matchedUser.failedAttempts = 0;
    matchedUser.lockedUntil = null as any;
    await this.userRepo.save(matchedUser);

    return { message: 'Password has been reset successfully' };
  }

  async setup(): Promise<{ tenant: any; user: any; credentials: any }> {
    // Check if any tenant exists - only allow setup on empty DB
    const existingTenants = await this.tenantsService.findAll();
    if (existingTenants && existingTenants.length > 0) {
      throw new ForbiddenException('System already set up. Use normal login.');
    }

    // Create default tenant
    const tenant = await this.tenantsService.create({
      name: 'Demo Company',
      slug: 'demo',
      plan: 'enterprise',
      country: 'SA',
      email: 'admin@demo.com',
    });

    // Create admin user
    const passwordHash = await bcrypt.hash('Admin@123', 12);
    const user = this.userRepo.create({
      name: 'Admin User',
      email: 'admin@demo.com',
      passwordHash,
      tenantId: tenant.id,
      isActive: true,
    });
    const savedUser = await this.userRepo.save(user);

    return {
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      user: { id: savedUser.id, email: savedUser.email, name: savedUser.name },
      credentials: {
        email: 'admin@demo.com',
        password: 'Admin@123',
        tenantSlug: 'demo',
      },
    };
  }

  async registerUser(tenantId: string, dto: RegisterUserDto): Promise<User> {
    const existing = await this.userRepo.findOne({
      where: { email: dto.email, tenantId },
    });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = this.userRepo.create({
      ...dto,
      tenantId,
      passwordHash,
    });
    const saved = await this.userRepo.save(user);

    // Assign roles
    if (dto.roleIds?.length) {
      const userRoles = dto.roleIds.map((roleId) =>
        this.userRoleRepo.create({ userId: saved.id, roleId }),
      );
      await this.userRoleRepo.save(userRoles);
    }

    return saved;
  }

  private async generateTokens(user: User, tenantId: string, ip?: string, device?: string) {
    const roles = user.userRoles?.map((ur) => ur.role?.name).filter(Boolean) || [];
    const branchIds = user.userRoles?.flatMap((ur) => ur.branchIds || []) || [];

    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: user.id,
      tenantId,
      email: user.email,
      roles,
      branchIds,
    };

    const accessToken = this.jwtService.sign(payload as any);
    const refreshToken = this.jwtService.sign(payload as any, {
      secret: this.configService.get('jwt.refreshSecret'),
      expiresIn: this.configService.get('jwt.refreshExpiry'),
    });

    // Store session
    const tokenHash = await bcrypt.hash(refreshToken, 10);
    const session = this.sessionRepo.create({
      userId: user.id,
      tokenHash,
      ip,
      device,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    await this.sessionRepo.save(session);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        roles,
      },
    };
  }
}
