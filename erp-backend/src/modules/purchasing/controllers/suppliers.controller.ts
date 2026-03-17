import { Controller, Get, Post, Patch, Delete, Param, Body } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { SuppliersService } from '../services/suppliers.service';
import { CreateSupplierDto } from '../dto/create-supplier.dto';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';

@ApiTags('purchasing')
@ApiBearerAuth()
@Controller('purchasing/suppliers')
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @RequirePermissions({ module: 'purchasing', screen: 'suppliers', action: 'create' })
  @Post()
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateSupplierDto) {
    return this.suppliersService.create(tenantId, dto);
  }

  @RequirePermissions({ module: 'purchasing', screen: 'suppliers', action: 'read' })
  @Get()
  findAll(@CurrentTenant() tenantId: string) {
    return this.suppliersService.findAll(tenantId);
  }

  @RequirePermissions({ module: 'purchasing', screen: 'suppliers', action: 'read' })
  @Get(':id')
  findById(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.suppliersService.findById(tenantId, id);
  }

  @RequirePermissions({ module: 'purchasing', screen: 'suppliers', action: 'update' })
  @Patch(':id')
  update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: Partial<CreateSupplierDto>,
  ) {
    return this.suppliersService.update(tenantId, id, dto);
  }

  @RequirePermissions({ module: 'purchasing', screen: 'suppliers', action: 'delete' })
  @Delete(':id')
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.suppliersService.remove(tenantId, id);
  }
}
