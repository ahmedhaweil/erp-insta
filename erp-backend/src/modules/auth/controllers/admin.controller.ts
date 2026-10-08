import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { UsersService } from '../services/users.service';
import { RolesService } from '../services/roles.service';
import { AuditService } from '../services/audit.service';
import { PermissionCatalogService } from '../services/permission-catalog.service';
import {
  AdminResetPasswordDto,
  CreateRoleDto,
  CreateUserDto,
  SetRolePermissionsDto,
  SetUserRolesDto,
  UpdateRoleDto,
  UpdateUserDto,
} from '../dto/admin.dto';

@ApiTags('auth')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @RequirePermissions({ module: 'settings', screen: 'users', action: 'read' })
  @Get()
  findAll(@CurrentTenant() tenantId: string) {
    return this.usersService.findAll(tenantId);
  }

  @RequirePermissions({ module: 'settings', screen: 'users', action: 'read' })
  @Get(':id')
  findById(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findById(tenantId, id);
  }

  @RequirePermissions({ module: 'settings', screen: 'users', action: 'create' })
  @Post()
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateUserDto) {
    return this.usersService.create(tenantId, dto);
  }

  @RequirePermissions({ module: 'settings', screen: 'users', action: 'update' })
  @Patch(':id')
  update(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(tenantId, user.sub, id, dto);
  }

  @RequirePermissions({ module: 'settings', screen: 'users', action: 'update' })
  @Put(':id/roles')
  setRoles(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetUserRolesDto,
  ) {
    return this.usersService.setRoles(tenantId, user.sub, id, dto.roles);
  }

  @RequirePermissions({ module: 'settings', screen: 'users', action: 'update' })
  @Post(':id/reset-password')
  resetPassword(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminResetPasswordDto,
  ) {
    return this.usersService.resetPassword(tenantId, id, dto.password);
  }
}

@ApiTags('auth')
@ApiBearerAuth()
@Controller('roles')
export class RolesController {
  constructor(
    private readonly rolesService: RolesService,
    private readonly catalog: PermissionCatalogService,
  ) {}

  @RequirePermissions({ module: 'settings', screen: 'roles', action: 'read' })
  @Get('permissions/catalog')
  permissionCatalog() {
    return this.catalog.list();
  }

  @RequirePermissions({ module: 'settings', screen: 'roles', action: 'read' })
  @Get()
  findAll(@CurrentTenant() tenantId: string) {
    return this.rolesService.findAll(tenantId);
  }

  @RequirePermissions({ module: 'settings', screen: 'roles', action: 'read' })
  @Get(':id')
  findById(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.rolesService.findById(tenantId, id);
  }

  @RequirePermissions({ module: 'settings', screen: 'roles', action: 'create' })
  @Post()
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateRoleDto) {
    return this.rolesService.create(tenantId, dto);
  }

  @RequirePermissions({ module: 'settings', screen: 'roles', action: 'update' })
  @Patch(':id')
  update(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.rolesService.update(tenantId, id, dto);
  }

  @RequirePermissions({ module: 'settings', screen: 'roles', action: 'update' })
  @Put(':id/permissions')
  setPermissions(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetRolePermissionsDto,
  ) {
    return this.rolesService.setPermissions(tenantId, id, dto.permissions);
  }

  @RequirePermissions({ module: 'settings', screen: 'roles', action: 'delete' })
  @Delete(':id')
  remove(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.rolesService.remove(tenantId, id);
  }
}

@ApiTags('auth')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly auditService: AuditService) {}

  @RequirePermissions({ module: 'settings', screen: 'audit', action: 'read' })
  @Get()
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'module', required: false })
  @ApiQuery({ name: 'recordId', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'limit', required: false })
  find(
    @CurrentTenant() tenantId: string,
    @Query('userId') userId?: string,
    @Query('module') module?: string,
    @Query('recordId') recordId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: number,
  ) {
    return this.auditService.find(tenantId, { userId, module, recordId, from, to, limit });
  }
}
