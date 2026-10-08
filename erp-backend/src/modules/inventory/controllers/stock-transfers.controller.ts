import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { StockTransfersService } from '../services/stock-transfers.service';
import { CreateStockTransferDto, ReceiveStockTransferDto } from '../dto/stock-transfer-document.dto';
import { StockTransferStatus } from '../entities/stock-transfer.entity';

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory/transfers')
export class StockTransfersController {
  constructor(private readonly transfers: StockTransfersService) {}

  @RequirePermissions({ module: 'inventory', screen: 'transfers', action: 'create' })
  @Post()
  @ApiOperation({ summary: 'Create a transfer (draft, or done at once with direct=true)' })
  create(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Body() dto: CreateStockTransferDto) {
    return this.transfers.create(tenantId, user.sub, dto);
  }

  @RequirePermissions({ module: 'inventory', screen: 'transfers', action: 'read' })
  @Get()
  @ApiQuery({ name: 'status', required: false, enum: StockTransferStatus })
  @ApiQuery({ name: 'warehouseId', required: false })
  findAll(
    @CurrentTenant() tenantId: string,
    @Query('status') status?: StockTransferStatus,
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.transfers.findAll(tenantId, { status, warehouseId });
  }

  @RequirePermissions({ module: 'inventory', screen: 'transfers', action: 'read' })
  @Get(':id')
  findById(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.transfers.findById(tenantId, id);
  }

  @RequirePermissions({ module: 'inventory', screen: 'transfers', action: 'update' })
  @Post(':id/ship')
  @ApiOperation({ summary: 'Ship: stock leaves the source warehouse (in transit)' })
  ship(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.transfers.ship(tenantId, user.sub, id);
  }

  @RequirePermissions({ module: 'inventory', screen: 'transfers', action: 'update' })
  @Post(':id/receive')
  @ApiOperation({ summary: 'Receive in the destination warehouse (partial receipt allowed)' })
  receive(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ReceiveStockTransferDto,
  ) {
    return this.transfers.receive(tenantId, user.sub, id, dto);
  }

  @RequirePermissions({ module: 'inventory', screen: 'transfers', action: 'update' })
  @Post(':id/validate')
  @ApiOperation({ summary: 'One-step: ship (if draft) and receive everything' })
  validate(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.transfers.validate(tenantId, user.sub, id);
  }

  @RequirePermissions({ module: 'inventory', screen: 'transfers', action: 'update' })
  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel a draft or an unreceived shipment (stock returns to source)' })
  cancel(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.transfers.cancel(tenantId, user.sub, id);
  }
}
