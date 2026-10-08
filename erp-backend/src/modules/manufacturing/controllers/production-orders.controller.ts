import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { ProductionOrdersService } from '../services/production-orders.service';
import { ManufacturingReportsService } from '../services/manufacturing-reports.service';
import {
  ConfirmProductionOrderDto,
  CreateProductionOrderDto,
  CreateScrapDto,
  ProduceDto,
  ProductionOrderQueryDto,
  RequirementsQueryDto,
} from '../dto/production.dto';

const read = { module: 'manufacturing', screen: 'production', action: 'read' };
const update = { module: 'manufacturing', screen: 'production', action: 'update' };

@ApiTags('manufacturing')
@ApiBearerAuth()
@Controller('manufacturing/production-orders')
export class ProductionOrdersController {
  constructor(private readonly service: ProductionOrdersService) {}

  @RequirePermissions({ module: 'manufacturing', screen: 'production', action: 'create' })
  @Post()
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateProductionOrderDto,
  ) {
    return this.service.create(tenantId, user.sub, dto);
  }

  @RequirePermissions(read)
  @Get()
  findAll(@CurrentTenant() tenantId: string, @Query() query: ProductionOrderQueryDto) {
    return this.service.findAll(tenantId, query);
  }

  @RequirePermissions(read)
  @Get(':id')
  findById(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.findById(tenantId, id);
  }

  @RequirePermissions({ module: 'manufacturing', screen: 'production', action: 'delete' })
  @Delete(':id')
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.remove(tenantId, id);
  }

  @RequirePermissions(read)
  @Get(':id/availability')
  @ApiOperation({ summary: 'Component availability in the source warehouse' })
  availability(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.checkAvailability(tenantId, id);
  }

  @RequirePermissions(update)
  @Post(':id/confirm')
  confirm(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: ConfirmProductionOrderDto,
  ) {
    return this.service.confirm(tenantId, id, dto);
  }

  @RequirePermissions(update)
  @Post(':id/start')
  start(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.start(tenantId, id);
  }

  @RequirePermissions(update)
  @Post(':id/produce')
  @ApiOperation({ summary: 'Record a (partial) production run' })
  produce(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ProduceDto,
  ) {
    return this.service.produce(tenantId, user.sub, id, dto);
  }

  @RequirePermissions(update)
  @Post(':id/finish')
  finish(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.finish(tenantId, id);
  }

  @RequirePermissions(update)
  @Post(':id/cancel')
  cancel(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.cancel(tenantId, id);
  }

  @RequirePermissions(read)
  @Get(':id/cost')
  @ApiOperation({ summary: 'Standard vs actual production cost' })
  cost(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.costReport(tenantId, id);
  }

  @RequirePermissions(read)
  @Get(':id/runs')
  runs(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.getRecords(tenantId, id);
  }
}

@ApiTags('manufacturing')
@ApiBearerAuth()
@Controller('manufacturing')
export class ManufacturingController {
  constructor(
    private readonly service: ProductionOrdersService,
    private readonly reports: ManufacturingReportsService,
  ) {}

  @RequirePermissions(update)
  @Post('scraps')
  @ApiOperation({ summary: 'Scrap goods (optionally on a production order)' })
  scrap(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateScrapDto,
  ) {
    return this.service.scrap(tenantId, user.sub, dto);
  }

  @RequirePermissions(read)
  @Get('scraps')
  @ApiQuery({ name: 'productionOrderId', required: false })
  scraps(
    @CurrentTenant() tenantId: string,
    @Query('productionOrderId') productionOrderId?: string,
  ) {
    return this.service.findScraps(tenantId, productionOrderId);
  }

  @RequirePermissions(read)
  @Get('reports/requirements')
  @ApiOperation({ summary: 'Component requirements: required vs available vs to buy' })
  requirements(@CurrentTenant() tenantId: string, @Query() query: RequirementsQueryDto) {
    return this.reports.requirements(tenantId, query);
  }

  @RequirePermissions(read)
  @Get('reports/production-costs')
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  productionCosts(
    @CurrentTenant() tenantId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reports.productionCostSummary(tenantId, from, to);
  }
}
