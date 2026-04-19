import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Warehouse } from '../entities/warehouse.entity';
import { CreateWarehouseDto } from '../dto/create-warehouse.dto';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory/warehouses')
export class WarehousesController {
  constructor(
    @InjectRepository(Warehouse)
    private readonly warehouseRepo: Repository<Warehouse>,
  ) {}

  @RequirePermissions({ module: 'inventory', screen: 'warehouses', action: 'create' })
  @Post()
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateWarehouseDto) {
    const warehouse = this.warehouseRepo.create({ ...dto, tenantId });
    return this.warehouseRepo.save(warehouse).then(w => ({ data: w }));
  }

  @RequirePermissions({ module: 'inventory', screen: 'warehouses', action: 'read' })
  @Get()
  findAll(@CurrentTenant() tenantId: string) {
    return this.warehouseRepo.find({ where: { tenantId } }).then(w => ({ data: w }));
  }

  @RequirePermissions({ module: 'inventory', screen: 'warehouses', action: 'read' })
  @Get(':id')
  findById(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.warehouseRepo.findOne({ where: { id, tenantId } }).then(w => ({ data: w }));
  }

  @RequirePermissions({ module: 'inventory', screen: 'warehouses', action: 'update' })
  @Patch(':id')
  update(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: Partial<CreateWarehouseDto>) {
    return this.warehouseRepo.update({ id, tenantId }, dto).then(() =>
      this.warehouseRepo.findOne({ where: { id, tenantId } })
    ).then(w => ({ data: w }));
  }

  @RequirePermissions({ module: 'inventory', screen: 'warehouses', action: 'delete' })
  @Delete(':id')
  deactivate(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.warehouseRepo.update({ id, tenantId }, { isActive: false }).then(() => ({ data: { success: true } }));
  }
}
