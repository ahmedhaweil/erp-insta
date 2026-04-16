import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { SalesOrdersService } from '../services/sales-orders.service';
import { CreateSalesOrderDto } from '../dto/create-sales-order.dto';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';

@ApiTags('sales')
@ApiBearerAuth()
@Controller('sales/orders')
export class SalesOrdersController {
  constructor(private readonly salesOrdersService: SalesOrdersService) {}

  @RequirePermissions({ module: 'sales', screen: 'orders', action: 'create' })
  @Post()
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateSalesOrderDto,
  ) {
    return this.salesOrdersService.create(tenantId, user.sub, dto);
  }

  @RequirePermissions({ module: 'sales', screen: 'orders', action: 'read' })
  @Get()
  findAll(@CurrentTenant() tenantId: string) {
    return this.salesOrdersService.findAll(tenantId);
  }

  @RequirePermissions({ module: 'sales', screen: 'orders', action: 'read' })
  @Get(':id')
  findById(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.salesOrdersService.findById(tenantId, id);
  }

  @RequirePermissions({ module: 'sales', screen: 'orders', action: 'update' })
  @Post(':id/confirm')
  confirm(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.salesOrdersService.confirm(tenantId, user.sub, id);
  }

  @RequirePermissions({ module: 'sales', screen: 'orders', action: 'update' })
  @Post(':id/cancel')
  cancel(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.salesOrdersService.cancel(tenantId, id);
  }
}
