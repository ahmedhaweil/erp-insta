import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  UnauthorizedException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { User } from '../entities/user.entity';
import { Session } from '../entities/session.entity';
import { UserRole } from '../entities/user-role.entity';
import { TenantsService } from '@modules/tenants/services/tenants.service';

jest.mock('bcrypt');
jest.mock('otplib', () => ({
  authenticator: { verify: jest.fn() },
}));

describe('AuthService', () => {
  let service: AuthService;
  let userRepo: Record<string, jest.Mock>;
  let sessionRepo: Record<string, jest.Mock>;
  let userRoleRepo: Record<string, jest.Mock>;
  let jwtService: Record<string, jest.Mock>;
  let configService: Record<string, jest.Mock>;
  let tenantsService: Record<string, jest.Mock>;

  const mockTenant = { id: 'tenant-1', slug: 'acme', isActive: true };
  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    passwordHash: 'hashed-password',
    failedAttempts: 0,
    lockedUntil: null,
    twoFaEnabled: false,
    twoFaSecret: null,
    lastLogin: null,
    tenantId: 'tenant-1',
    userRoles: [{ role: { name: 'admin' }, branchIds: ['branch-1'] }],
  };

  beforeEach(async () => {
    userRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn((dto) => dto),
    };
    sessionRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn((dto) => dto),
      update: jest.fn(),
    };
    userRoleRepo = {
      create: jest.fn((dto) => dto),
      save: jest.fn(),
    };
    jwtService = {
      sign: jest.fn().mockReturnValue('mock-token'),
      verify: jest.fn(),
    };
    configService = {
      get: jest.fn((key: string) => {
        const map: Record<string, string> = {
          'jwt.refreshSecret': 'refresh-secret',
          'jwt.refreshExpiry': '7d',
        };
        return map[key];
      }),
    };
    tenantsService = {
      findBySlug: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Session), useValue: sessionRepo },
        { provide: getRepositoryToken(UserRole), useValue: userRoleRepo },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
        { provide: TenantsService, useValue: tenantsService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('login', () => {
    const loginDto = { email: 'test@example.com', password: 'password123', tenantSlug: 'acme' };

    it('should return tokens on successful login', async () => {
      tenantsService.findBySlug.mockResolvedValue(mockTenant);
      userRepo.findOne.mockResolvedValue({ ...mockUser });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-refresh');

      const result = await service.login(loginDto, '127.0.0.1', 'Chrome');

      expect(tenantsService.findBySlug).toHaveBeenCalledWith('acme');
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result).toHaveProperty('user');
    });

    it('should throw ForbiddenException if tenant is inactive', async () => {
      tenantsService.findBySlug.mockResolvedValue({ ...mockTenant, isActive: false });

      await expect(service.login(loginDto)).rejects.toThrow(ForbiddenException);
    });

    it('should throw UnauthorizedException if user not found', async () => {
      tenantsService.findBySlug.mockResolvedValue(mockTenant);
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw ForbiddenException if account is locked', async () => {
      tenantsService.findBySlug.mockResolvedValue(mockTenant);
      userRepo.findOne.mockResolvedValue({
        ...mockUser,
        lockedUntil: new Date(Date.now() + 60000),
      });

      await expect(service.login(loginDto)).rejects.toThrow(ForbiddenException);
    });

    it('should increment failedAttempts on wrong password', async () => {
      tenantsService.findBySlug.mockResolvedValue(mockTenant);
      const user = { ...mockUser, failedAttempts: 0 };
      userRepo.findOne.mockResolvedValue(user);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
      expect(userRepo.save).toHaveBeenCalledWith(expect.objectContaining({ failedAttempts: 1 }));
    });

    it('should lock account after 5 failed attempts', async () => {
      tenantsService.findBySlug.mockResolvedValue(mockTenant);
      const user = { ...mockUser, failedAttempts: 4 };
      userRepo.findOne.mockResolvedValue(user);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
      expect(userRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          failedAttempts: 5,
          lockedUntil: expect.any(Date),
        }),
      );
    });

    it('should return 2FA temp token if 2FA is enabled', async () => {
      tenantsService.findBySlug.mockResolvedValue(mockTenant);
      userRepo.findOne.mockResolvedValue({ ...mockUser, twoFaEnabled: true });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login(loginDto);

      expect(result).toEqual({ requires2fa: true, tempToken: 'mock-token' });
    });
  });

  describe('logout', () => {
    it('should revoke all active sessions for the user', async () => {
      await service.logout('user-1');
      expect(sessionRepo.update).toHaveBeenCalledWith(
        { userId: 'user-1', revoked: false },
        { revoked: true },
      );
    });
  });

  describe('registerUser', () => {
    const registerDto = {
      email: 'new@example.com',
      password: 'password123',
      name: 'New User',
      roleIds: ['role-1'],
    };

    it('should create a new user and assign roles', async () => {
      userRepo.findOne.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-pw');
      userRepo.save.mockResolvedValue({ id: 'new-user-id', ...registerDto });

      const result = await service.registerUser('tenant-1', registerDto);

      expect(userRepo.save).toHaveBeenCalled();
      expect(userRoleRepo.save).toHaveBeenCalled();
      expect(result).toHaveProperty('id');
    });

    it('should throw ConflictException if email already exists', async () => {
      userRepo.findOne.mockResolvedValue(mockUser);

      await expect(service.registerUser('tenant-1', registerDto)).rejects.toThrow(
        ConflictException,
      );
    });
  });
});
