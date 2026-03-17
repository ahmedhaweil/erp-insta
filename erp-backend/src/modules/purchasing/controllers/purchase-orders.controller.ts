import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PurchaseOrdersService } from '../services/purchase-orders.service';
import { CreatePurchaseOrderDto } from '../dto/create-purchase-order.dto';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';

@ApiTags('purchasing')
@ApiBearerAuth()
@Controller('purchasing/orders')
export class PurchaseOrdersController {
  constructor(private readonly ordersService: PurchaseOrdersService) {}

  @RequirePermissions({ module: 'purchasing', screen: 'orders', action: 'create' })
  @Post()
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePurchaseOrderDto,
  ) {
    return this.ordersService.create(tenantId, user.sub, dto);
  }

  @RequirePermissions({ module: 'purchasing', screen: 'orders', action: 'read' })
  @Get()
  findAll(@CurrentTenant() tenantId: string) {
    return this.ordersService.findAll(tenantId);
  }

  @RequirePermissions({ module: 'purchasing', screen: 'orders', action: 'read' })
  @Get(':id')
  findById(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.ordersService.findById(tenantId, id);
  }

  @RequirePermissions({ module: 'purchasing', screen: 'orders', action: 'update' })
  @Post(':id/confirm')
  confirm(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.ordersService.confirm(tenantId, user.sub, id);
  }

  @RequirePermissions({ module: 'purchasing', screen: 'orders', action: 'update' })
  @Post(':id/cancel')
  cancel(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.ordersService.cancel(tenantId, id);
  }
}
