import { Controller, Get, Post, Patch, Param, Body, Query, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { PosActor, PosService } from '../services/pos.service';
import { RbacService } from '@modules/auth/services/rbac.service';
import { OpenSessionDto } from '../dto/open-session.dto';
import { CloseSessionDto } from '../dto/close-session.dto';
import { CreatePosOrderDto } from '../dto/create-pos-order.dto';
import {
  CashMovementDto,
  CreateTerminalDto,
  RefundPosOrderDto,
  UpdateTerminalDto,
} from '../dto/terminal.dto';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';

@ApiTags('pos')
@ApiBearerAuth()
@Controller('pos')
export class PosController {
  constructor(
    private readonly posService: PosService,
    private readonly rbac: RbacService,
  ) {}

  private async actor(user: JwtPayload): Promise<PosActor> {
    const [canOverrideDiscount, canManageSessions] = await Promise.all([
      this.rbac.hasPermission(user.tenantId, user.sub, {
        module: 'pos',
        screen: 'discounts',
        action: 'override',
      }),
      this.rbac.hasPermission(user.tenantId, user.sub, {
        module: 'pos',
        screen: 'sessions',
        action: 'manage',
      }),
    ]);
    return { userId: user.sub, canOverrideDiscount, canManageSessions };
  }

  @RequirePermissions({ module: 'pos', screen: 'sessions', action: 'create' })
  @Post('sessions/open')
  openSession(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: OpenSessionDto,
  ) {
    return this.posService.openSession(tenantId, user.sub, dto);
  }

  @RequirePermissions({ module: 'pos', screen: 'sessions', action: 'update' })
  @Post('sessions/:id/close')
  async closeSession(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CloseSessionDto,
  ) {
    return this.posService.closeSession(tenantId, await this.actor(user), id, dto);
  }

  @RequirePermissions({ module: 'pos', screen: 'sessions', action: 'update' })
  @Post('sessions/:id/cash-movements')
  async addCashMovement(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CashMovementDto,
  ) {
    return this.posService.addCashMovement(tenantId, await this.actor(user), id, dto);
  }

  @RequirePermissions({ module: 'pos', screen: 'sessions', action: 'read' })
  @Get('sessions/:id/cash-movements')
  findCashMovements(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.posService.findCashMovements(tenantId, id);
  }

  @RequirePermissions({ module: 'pos', screen: 'orders', action: 'create' })
  @Post('orders')
  async createOrder(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePosOrderDto,
  ) {
    return this.posService.createOrder(tenantId, await this.actor(user), dto);
  }

  @RequirePermissions({ module: 'pos', screen: 'orders', action: 'update' })
  @Post('orders/:id/refund')
  async refundOrder(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: RefundPosOrderDto,
  ) {
    return this.posService.refundOrder(tenantId, await this.actor(user), id, dto.sessionId, dto.lines);
  }

  @RequirePermissions({ module: 'pos', screen: 'terminals', action: 'read' })
  @Get('terminals')
  findTerminals(@CurrentTenant() tenantId: string) {
    return this.posService.findTerminals(tenantId);
  }

  @RequirePermissions({ module: 'pos', screen: 'terminals', action: 'create' })
  @Post('terminals')
  createTerminal(@CurrentTenant() tenantId: string, @Body() dto: CreateTerminalDto) {
    return this.posService.createTerminal(tenantId, dto);
  }

  @RequirePermissions({ module: 'pos', screen: 'terminals', action: 'update' })
  @Patch('terminals/:id')
  updateTerminal(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTerminalDto,
  ) {
    return this.posService.updateTerminal(tenantId, id, dto);
  }

  @RequirePermissions({ module: 'pos', screen: 'sessions', action: 'read' })
  @Get('sessions')
  @ApiQuery({ name: 'terminalId', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ['open', 'closed'] })
  @ApiQuery({ name: 'mine', required: false, type: Boolean })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  findSessions(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Query('terminalId') terminalId?: string,
    @Query('status') status?: string,
    @Query('mine') mine?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.posService.findSessions(tenantId, {
      terminalId,
      status,
      userId: mine === 'true' ? user.sub : undefined,
      from,
      to,
    });
  }

  @RequirePermissions({ module: 'pos', screen: 'orders', action: 'read' })
  @Get('orders')
  @ApiQuery({ name: 'sessionId', required: false })
  @ApiQuery({ name: 'customerId', required: false })
  @ApiQuery({ name: 'search', required: false, description: 'Order number or client reference' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'refunds', required: false, type: Boolean })
  @ApiQuery({ name: 'refundedOrderId', required: false, description: 'Refunds of this sale' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
  findOrders(
    @CurrentTenant() tenantId: string,
    @Query('sessionId') sessionId?: string,
    @Query('customerId') customerId?: string,
    @Query('search') search?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('refunds') refunds?: string,
    @Query('refundedOrderId') refundedOrderId?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    return this.posService.findOrders(tenantId, {
      sessionId,
      customerId,
      search,
      from,
      to,
      refunds: refunds === undefined ? undefined : refunds === 'true',
      refundedOrderId,
      limit,
      offset,
    });
  }

  @RequirePermissions({ module: 'pos', screen: 'orders', action: 'read' })
  @Get('orders/:id')
  findOrder(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.posService.findOrder(tenantId, id);
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
