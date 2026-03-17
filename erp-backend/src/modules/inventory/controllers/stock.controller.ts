import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { StockService } from '../services/stock.service';
import { StockAdjustmentDto } from '../dto/stock-adjustment.dto';
import { StockTransferDto } from '../dto/stock-transfer.dto';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory/stock')
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @RequirePermissions({ module: 'inventory', screen: 'stock', action: 'read' })
  @Get()
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
  @Post('adjust')
  adjust(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: StockAdjustmentDto,
  ) {
    return this.stockService.adjust(tenantId, user.sub, dto);
  }

  @RequirePermissions({ module: 'inventory', screen: 'stock', action: 'create' })
  @Post('transfer')
  transfer(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: StockTransferDto,
  ) {
    return this.stockService.transfer(tenantId, user.sub, dto);
  }
}
