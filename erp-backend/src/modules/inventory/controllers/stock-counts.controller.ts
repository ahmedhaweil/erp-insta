import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { StockCountsService } from '../services/stock-counts.service';
import { CreateStockCountDto, UpdateStockCountLinesDto, ValidateStockCountDto } from '../dto/stock-count.dto';
import { StockCountStatus } from '../entities/stock-count.entity';

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory/stock-counts')
export class StockCountsController {
  constructor(private readonly counts: StockCountsService) {}

  @RequirePermissions({ module: 'inventory', screen: 'stocktaking', action: 'create' })
  @Post()
  @ApiOperation({ summary: 'Open a count session and snapshot system quantities' })
  create(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Body() dto: CreateStockCountDto) {
    return this.counts.create(tenantId, user.sub, dto);
  }

  @RequirePermissions({ module: 'inventory', screen: 'stocktaking', action: 'read' })
  @Get()
  @ApiQuery({ name: 'status', required: false, enum: StockCountStatus })
  @ApiQuery({ name: 'warehouseId', required: false })
  findAll(
    @CurrentTenant() tenantId: string,
    @Query('status') status?: StockCountStatus,
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.counts.findAll(tenantId, { status, warehouseId });
  }

  @RequirePermissions({ module: 'inventory', screen: 'stocktaking', action: 'read' })
  @Get(':id')
  @ApiOperation({ summary: 'Count lines with differences, values and warnings' })
  findById(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.counts.findById(tenantId, id);
  }

  @RequirePermissions({ module: 'inventory', screen: 'stocktaking', action: 'update' })
  @Put(':id/lines')
  @ApiOperation({ summary: 'Enter counted quantities in bulk (by line, product + lot, or barcode)' })
  updateLines(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: UpdateStockCountLinesDto) {
    return this.counts.updateLines(tenantId, id, dto);
  }

  @RequirePermissions({ module: 'inventory', screen: 'stocktaking', action: 'update' })
  @Post(':id/validate')
  @ApiOperation({ summary: 'Apply the differences as stock adjustments and post them' })
  validate(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ValidateStockCountDto,
  ) {
    return this.counts.validate(tenantId, user.sub, id, dto);
  }

  @RequirePermissions({ module: 'inventory', screen: 'stocktaking', action: 'update' })
  @Post(':id/cancel')
  cancel(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.counts.cancel(tenantId, id);
  }
}
