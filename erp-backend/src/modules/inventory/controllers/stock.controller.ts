import { Controller, Get, Post, Put, Body, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiQuery, ApiOperation } from '@nestjs/swagger';
import { StockService } from '../services/stock.service';
import { InventorySettingsService } from '../services/inventory-settings.service';
import { StockAdjustmentDto } from '../dto/stock-adjustment.dto';
import { StockTransferDto } from '../dto/stock-transfer.dto';
import { InventorySettingsDto, StockReceiptDto } from '../dto/stock-receipt.dto';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory')
export class StockController {
  constructor(
    private readonly stockService: StockService,
    private readonly settingsService: InventorySettingsService,
  ) {}

  @RequirePermissions({ module: 'inventory', screen: 'stock', action: 'read' })
  @Get('stock')
  @ApiQuery({ name: 'productId', required: false })
  @ApiQuery({ name: 'warehouseId', required: false })
  getStock(
    @CurrentTenant() tenantId: string,
    @Query('productId') productId?: string,
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.stockService.getStock(tenantId, productId, warehouseId);
  }

  @RequirePermissions({ module: 'inventory', screen: 'stock', action: 'create' })
  @Post('stock/adjust')
  adjust(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: StockAdjustmentDto,
  ) {
    return this.stockService.adjust(tenantId, user.sub, dto);
  }

  @RequirePermissions({ module: 'inventory', screen: 'stock', action: 'create' })
  @Post('stock/transfer')
  transfer(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: StockTransferDto,
  ) {
    return this.stockService.transfer(tenantId, user.sub, dto);
  }

  @RequirePermissions({ module: 'inventory', screen: 'lots', action: 'create' })
  @Post('stock/receive')
  @ApiOperation({ summary: 'Manual receipt with explicit lots/serials (rejects tracked products without lots)' })
  receive(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: StockReceiptDto,
  ) {
    return this.stockService.manualReceipt(tenantId, user.sub, dto);
  }

  @RequirePermissions({ module: 'inventory', screen: 'stock', action: 'read' })
  @Get('stock/movements')
  @ApiQuery({ name: 'productId', required: false })
  @ApiQuery({ name: 'warehouseId', required: false })
  getMovements(
    @CurrentTenant() tenantId: string,
    @Query('productId') productId?: string,
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.stockService.getMovements(tenantId, productId, warehouseId);
  }

  @RequirePermissions({ module: 'inventory', screen: 'stock', action: 'read' })
  @Get('stock/valuation')
  @ApiQuery({ name: 'warehouseId', required: false })
  getValuation(
    @CurrentTenant() tenantId: string,
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.stockService.getValuation(tenantId, warehouseId);
  }

  @RequirePermissions({ module: 'inventory', screen: 'stock', action: 'read' })
  @Get('settings')
  getSettings(@CurrentTenant() tenantId: string) {
    return this.settingsService.get(tenantId);
  }

  @RequirePermissions({ module: 'inventory', screen: 'stock', action: 'update' })
  @Put('settings')
  @ApiOperation({ summary: 'Tenant inventory options (negative stock, expiry alert horizon)' })
  updateSettings(@CurrentTenant() tenantId: string, @Body() dto: InventorySettingsDto) {
    return this.settingsService.update(tenantId, dto);
  }
}
