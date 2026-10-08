import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Delete,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { TenantsService } from '../services/tenants.service';
import { CreateTenantDto } from '../dto/create-tenant.dto';
import { UpdateTenantDto } from '../dto/update-tenant.dto';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';

/**
 * Tenants are isolated from each other: a user only ever sees and manages
 * their own tenant. Provisioning new tenants and listing all of them is a
 * platform operation reserved to users of the tenant named by
 * PLATFORM_TENANT_ID; it is disabled when that variable is unset.
 */
@ApiTags('tenants')
@ApiBearerAuth()
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @RequirePermissions({ module: 'settings', screen: 'tenants', action: 'create' })
  @Post()
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateTenantDto) {
    this.assertPlatformOperator(tenantId);
    return this.tenantsService.create(dto);
  }

  @RequirePermissions({ module: 'settings', screen: 'tenants', action: 'read' })
  @Get()
  async findAll(@CurrentTenant() tenantId: string) {
    if (this.isPlatformOperator(tenantId)) return this.tenantsService.findAll();
    return [await this.tenantsService.findById(tenantId)];
  }

  @RequirePermissions({ module: 'settings', screen: 'tenants', action: 'read' })
  @Get('current')
  current(@CurrentTenant() tenantId: string) {
    return this.tenantsService.findById(tenantId);
  }

  @RequirePermissions({ module: 'settings', screen: 'tenants', action: 'read' })
  @Get(':id')
  findById(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    this.assertAccessible(tenantId, id);
    return this.tenantsService.findById(id);
  }

  @RequirePermissions({ module: 'settings', screen: 'tenants', action: 'update' })
  @Patch(':id')
  update(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: UpdateTenantDto) {
    this.assertAccessible(tenantId, id);
    if (dto.slug !== undefined && !this.isPlatformOperator(tenantId)) {
      throw new ForbiddenException('The tenant slug can only be changed by the platform operator');
    }
    return this.tenantsService.update(id, dto);
  }

  @RequirePermissions({ module: 'settings', screen: 'tenants', action: 'delete' })
  @Delete(':id')
  deactivate(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    this.assertPlatformOperator(tenantId);
    return this.tenantsService.deactivate(id);
  }

  private isPlatformOperator(tenantId: string): boolean {
    const platformTenantId = process.env.PLATFORM_TENANT_ID;
    return !!platformTenantId && platformTenantId === tenantId;
  }

  private assertPlatformOperator(tenantId: string): void {
    if (!this.isPlatformOperator(tenantId)) {
      throw new ForbiddenException('Only the platform operator can manage other tenants');
    }
  }

  /** Other tenants are reported as missing so their ids cannot be probed. */
  private assertAccessible(tenantId: string, id: string): void {
    if (id !== tenantId && !this.isPlatformOperator(tenantId)) {
      throw new NotFoundException('Tenant not found');
    }
  }
}
