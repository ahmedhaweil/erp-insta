import { Controller, Get, Post, Patch, Delete, Param, Body, Query, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { ProductsService } from '../services/products.service';
import { CreateProductDto } from '../dto/create-product.dto';
import { ProductUnitDto } from '../dto/product-unit.dto';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory/products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @RequirePermissions({ module: 'inventory', screen: 'products', action: 'create' })
  @Post()
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateProductDto) {
    return this.productsService.create(tenantId, dto);
  }

  @RequirePermissions({ module: 'inventory', screen: 'products', action: 'read' })
  @Get()
  findAll(@CurrentTenant() tenantId: string) {
    return this.productsService.findAll(tenantId);
  }

  @RequirePermissions({ module: 'inventory', screen: 'products', action: 'read' })
  @Get('barcode/:code')
  @ApiOperation({ summary: 'POS lookup by product barcode, alternate unit barcode, code or SKU' })
  lookupBarcode(@CurrentTenant() tenantId: string, @Param('code') code: string) {
    return this.productsService.lookupBarcode(tenantId, code);
  }

  @RequirePermissions({ module: 'inventory', screen: 'products', action: 'read' })
  @Get(':id')
  findById(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.productsService.findById(tenantId, id);
  }

  @RequirePermissions({ module: 'inventory', screen: 'products', action: 'update' })
  @Patch(':id')
  update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: Partial<CreateProductDto>,
  ) {
    return this.productsService.update(tenantId, id, dto);
  }

  @RequirePermissions({ module: 'inventory', screen: 'products', action: 'delete' })
  @Delete(':id')
  deactivate(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.productsService.update(tenantId, id, { isActive: false } as any);
  }

  @RequirePermissions({ module: 'inventory', screen: 'units', action: 'read' })
  @Get(':id/units')
  findUnits(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.productsService.findUnits(tenantId, id);
  }

  @RequirePermissions({ module: 'inventory', screen: 'units', action: 'create' })
  @Post(':id/units')
  @ApiOperation({ summary: 'Add or update an alternate unit (e.g. carton = 12 pieces)' })
  upsertUnit(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: ProductUnitDto) {
    return this.productsService.upsertUnit(tenantId, id, dto);
  }

  @RequirePermissions({ module: 'inventory', screen: 'units', action: 'delete' })
  @Delete(':id/units/:productUnitId')
  async removeUnit(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Param('productUnitId') productUnitId: string,
  ) {
    await this.productsService.removeUnit(tenantId, id, productUnitId);
    return { deleted: true };
  }

  @RequirePermissions({ module: 'inventory', screen: 'units', action: 'read' })
  @Get(':id/convert')
  @ApiOperation({ summary: 'Convert a quantity in an alternate unit to the base unit' })
  @ApiQuery({ name: 'quantity', required: true })
  @ApiQuery({ name: 'unitId', required: false })
  async convert(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Query('quantity') quantity: string,
    @Query('unitId') unitId?: string,
  ) {
    const qty = Number(quantity);
    if (!Number.isFinite(qty)) throw new BadRequestException('quantity must be a number');
    const factor = await this.productsService.unitFactor(tenantId, id, unitId);
    const baseQuantity = await this.productsService.toBaseQuantity(tenantId, id, qty, unitId);
    return { productId: id, unitId: unitId ?? null, quantity: qty, factor, baseQuantity };
  }
}
