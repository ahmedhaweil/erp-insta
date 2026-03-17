import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PosService } from '../services/pos.service';
import { OpenSessionDto } from '../dto/open-session.dto';
import { CloseSessionDto } from '../dto/close-session.dto';
import { CreatePosOrderDto } from '../dto/create-pos-order.dto';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';

@ApiTags('pos')
@ApiBearerAuth()
@Controller('pos')
export class PosController {
  constructor(private readonly posService: PosService) {}

  @RequirePermissions({ module: 'pos', screen: 'sessions', action: 'create' })
  @Post('sessions/open')
  openSession(
    @CurrentTenant() tenantId: string,
    @Body() dto: OpenSessionDto,
  ) {
    // userId would typically come from auth context; using tenantId as placeholder
    return this.posService.openSession(tenantId, tenantId, dto);
  }

  @RequirePermissions({ module: 'pos', screen: 'sessions', action: 'update' })
  @Post('sessions/:id/close')
  closeSession(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: CloseSessionDto,
  ) {
    return this.posService.closeSession(tenantId, id, dto);
  }

  @RequirePermissions({ module: 'pos', screen: 'orders', action: 'create' })
  @Post('orders')
  createOrder(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreatePosOrderDto,
  ) {
    return this.posService.createOrder(tenantId, tenantId, dto);
  }

  @RequirePermissions({ module: 'pos', screen: 'orders', action: 'read' })
  @Get('sessions/:id/orders')
  getSessionOrders(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.posService.getSessionOrders(tenantId, id);
  }

  @RequirePermissions({ module: 'pos', screen: 'orders', action: 'read' })
  @Get('sessions/:id/summary')
  getDailySummary(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.posService.getDailySummary(tenantId, id);
  }
}
