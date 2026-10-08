import { Body, Controller, Get, Param, Patch, Post, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { MasterDataService } from '../services/master-data.service';
import { CreateWarehouseDto, UpdateWarehouseDto } from '../dto/create-warehouse.dto';
import { CreateCategoryDto, UpdateCategoryDto } from '../dto/create-category.dto';
import { CreateUnitDto, UpdateUnitDto } from '../dto/create-unit.dto';

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory')
export class MasterDataController {
  constructor(private readonly masterData: MasterDataService) {}

  @RequirePermissions({ module: 'inventory', screen: 'warehouses', action: 'read' })
  @Get('warehouses')
  findWarehouses(@CurrentTenant() tenantId: string) {
    return this.masterData.findWarehouses(tenantId);
  }

  @RequirePermissions({ module: 'inventory', screen: 'warehouses', action: 'create' })
  @Post('warehouses')
  createWarehouse(@CurrentTenant() tenantId: string, @Body() dto: CreateWarehouseDto) {
    return this.masterData.createWarehouse(tenantId, dto);
  }

  @RequirePermissions({ module: 'inventory', screen: 'warehouses', action: 'update' })
  @Patch('warehouses/:id')
  updateWarehouse(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWarehouseDto,
  ) {
    return this.masterData.updateWarehouse(tenantId, id, dto);
  }

  @RequirePermissions({ module: 'inventory', screen: 'products', action: 'read' })
  @Get('categories')
  findCategories(@CurrentTenant() tenantId: string) {
    return this.masterData.findCategories(tenantId);
  }

  @RequirePermissions({ module: 'inventory', screen: 'products', action: 'create' })
  @Post('categories')
  createCategory(@CurrentTenant() tenantId: string, @Body() dto: CreateCategoryDto) {
    return this.masterData.createCategory(tenantId, dto);
  }

  @RequirePermissions({ module: 'inventory', screen: 'products', action: 'read' })
  @Get('units')
  findUnits(@CurrentTenant() tenantId: string) {
    return this.masterData.findUnits(tenantId);
  }

  @RequirePermissions({ module: 'inventory', screen: 'products', action: 'create' })
  @Post('units')
  createUnit(@CurrentTenant() tenantId: string, @Body() dto: CreateUnitDto) {
    return this.masterData.createUnit(tenantId, dto);
  }

  @RequirePermissions({ module: 'inventory', screen: 'products', action: 'update' })
  @Patch('categories/:id')
  updateCategory(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.masterData.updateCategory(tenantId, id, dto);
  }

  @RequirePermissions({ module: 'inventory', screen: 'products', action: 'update' })
  @Patch('units/:id')
  updateUnit(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUnitDto,
  ) {
    return this.masterData.updateUnit(tenantId, id, dto);
  }
}
