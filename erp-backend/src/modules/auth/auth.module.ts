import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR, DiscoveryModule } from '@nestjs/core';
import { UsersService } from './services/users.service';
import { RolesService } from './services/roles.service';
import { AuditInterceptor, AuditService } from './services/audit.service';
import { PermissionCatalogService } from './services/permission-catalog.service';
import {
  AuditLogsController,
  RolesController,
  UsersController,
} from './controllers/admin.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { User } from './entities/user.entity';
import { Role } from './entities/role.entity';
import { Permission } from './entities/permission.entity';
import { RolePermission } from './entities/role-permission.entity';
import { UserRole } from './entities/user-role.entity';
import { Session } from './entities/session.entity';
import { AuditLog } from './entities/audit-log.entity';
import { AuthService } from './services/auth.service';
import { RbacService } from './services/rbac.service';
import { AuthController } from './controllers/auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { TenantsModule } from '@modules/tenants/tenants.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Role, Permission, RolePermission, UserRole, Session, AuditLog]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('jwt.secret'),
        signOptions: { expiresIn: config.get('jwt.expiry') },
      }),
    }),
    TenantsModule,
    DiscoveryModule,
  ],
  controllers: [AuthController, UsersController, RolesController, AuditLogsController],
  providers: [
    AuthService,
    RbacService,
    JwtStrategy,
    UsersService,
    RolesService,
    AuditService,
    PermissionCatalogService,
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
  exports: [AuthService, RbacService, AuditService, JwtModule],
})
export class AuthModule {}
