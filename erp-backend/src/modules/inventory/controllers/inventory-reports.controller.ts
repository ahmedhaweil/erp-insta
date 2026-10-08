import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { InventoryReportsService } from '../services/inventory-reports.service';
import { LotsService } from '../services/lots.service';
import { InventorySettingsService } from '../services/inventory-settings.service';

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory')
export class InventoryReportsController {
  constructor(
    private readonly reports: InventoryReportsService,
    private readonly lots: LotsService,
    private readonly settings: InventorySettingsService,
  ) {}

  @RequirePermissions({ module: 'inventory', screen: 'reports', action: 'read' })
  @Get('reports/item-card')
  @ApiOperation({ summary: 'Item card / stock ledger (كارت الصنف)' })
  @ApiQuery({ name: 'productId', required: true })
  @ApiQuery({ name: 'warehouseId', required: false })
  @ApiQuery({ name: 'from', required: false, description: 'YYYY-MM-DD (default 1 Jan of `to` year)' })
  @ApiQuery({ name: 'to', required: false, description: 'YYYY-MM-DD (default today)' })
  itemCard(
    @CurrentTenant() tenantId: string,
    @Query('productId') productId: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (!productId) throw new BadRequestException('productId is required');
    return this.reports.itemCard(tenantId, productId, { warehouseId, from, to });
  }

  @RequirePermissions({ module: 'inventory', screen: 'reports', action: 'read' })
  @Get('reports/stock-balance')
  @ApiQuery({ name: 'warehouseId', required: false })
  @ApiQuery({ name: 'categoryId', required: false })
  @ApiQuery({ name: 'includeZero', required: false, type: Boolean })
  stockBalance(
    @CurrentTenant() tenantId: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('categoryId') categoryId?: string,
    @Query('includeZero') includeZero?: string,
  ) {
    return this.reports.stockBalance(tenantId, { warehouseId, categoryId, includeZero: includeZero === 'true' });
  }

  @RequirePermissions({ module: 'inventory', screen: 'reports', action: 'read' })
  @Get('reports/slow-moving')
  @ApiQuery({ name: 'days', required: false, description: 'Default 90' })
  @ApiQuery({ name: 'warehouseId', required: false })
  slowMoving(
    @CurrentTenant() tenantId: string,
    @Query('days') days?: string,
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.reports.slowMoving(tenantId, { days: days ? Number(days) : undefined, warehouseId });
  }

  @RequirePermissions({ module: 'inventory', screen: 'reports', action: 'read' })
  @Get('reports/negative-stock')
  @ApiQuery({ name: 'warehouseId', required: false })
  negativeStock(@CurrentTenant() tenantId: string, @Query('warehouseId') warehouseId?: string) {
    return this.reports.negativeStock(tenantId, warehouseId);
  }

  @RequirePermissions({ module: 'inventory', screen: 'reports', action: 'read' })
  @Get('reports/reorder')
  @ApiQuery({ name: 'warehouseId', required: false })
  reorder(@CurrentTenant() tenantId: string, @Query('warehouseId') warehouseId?: string) {
    return this.reports.reorder(tenantId, warehouseId);
  }

  @RequirePermissions({ module: 'inventory', screen: 'lots', action: 'read' })
  @Get('lots')
  @ApiQuery({ name: 'productId', required: false })
  @ApiQuery({ name: 'warehouseId', required: false })
  @ApiQuery({ name: 'includeEmpty', required: false, type: Boolean })
  findLots(
    @CurrentTenant() tenantId: string,
    @Query('productId') productId?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('includeEmpty') includeEmpty?: string,
  ) {
    return this.lots.findLots(tenantId, { productId, warehouseId, includeEmpty: includeEmpty === 'true' });
  }

  @RequirePermissions({ module: 'inventory', screen: 'lots', action: 'read' })
  @Get('lots/expiring')
  @ApiOperation({ summary: 'Lots expiring within N days' })
  @ApiQuery({ name: 'days', required: false, description: 'Default: tenant expiryAlertDays (30)' })
  @ApiQuery({ name: 'warehouseId', required: false })
  async expiring(
    @CurrentTenant() tenantId: string,
    @Query('days') days?: string,
    @Query('warehouseId') warehouseId?: string,
  ) {
    const horizon = days ? Number(days) : (await this.settings.get(tenantId)).expiryAlertDays;
    return this.lots.expiring(tenantId, horizon, warehouseId);
  }

  @RequirePermissions({ module: 'inventory', screen: 'lots', action: 'read' })
  @Get('lots/expired')
  @ApiOperation({ summary: 'Expired lots still in stock' })
  @ApiQuery({ name: 'warehouseId', required: false })
  expired(@CurrentTenant() tenantId: string, @Query('warehouseId') warehouseId?: string) {
    return this.lots.expired(tenantId, warehouseId);
  }

  @RequirePermissions({ module: 'inventory', screen: 'lots', action: 'read' })
  @Get('lots/trace')
  @ApiOperation({ summary: 'Lot/serial traceability (origin, moves, balances)' })
  @ApiQuery({ name: 'productId', required: true })
  @ApiQuery({ name: 'lotNumber', required: true })
  trace(
    @CurrentTenant() tenantId: string,
    @Query('productId') productId: string,
    @Query('lotNumber') lotNumber: string,
  ) {
    if (!productId || !lotNumber) throw new BadRequestException('productId and lotNumber are required');
    return this.lots.trace(tenantId, productId, lotNumber);
  }
}
