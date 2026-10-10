import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { RbacService } from '@modules/auth/services/rbac.service';
import { RestaurantActor, TicketsService } from '../services/tickets.service';
import { KitchenService } from '../services/kitchen.service';
import {
  AddTicketLineDto,
  AssignDriverDto,
  CreateTicketDto,
  MergeTicketDto,
  PayTicketDto,
  ReasonDto,
  SplitPreviewQueryDto,
  SplitTicketDto,
  TicketQueryDto,
  TransferTicketDto,
  UpdateTicketDto,
  UpdateTicketLineDto,
  VoidTicketDto,
} from '../dto/restaurant.dto';

const M = 'restaurant';

@ApiTags('restaurant')
@ApiBearerAuth()
@Controller('restaurant/tickets')
export class TicketsController {
  constructor(
    private readonly tickets: TicketsService,
    private readonly kitchen: KitchenService,
    private readonly rbac: RbacService,
  ) {}

  private async actor(user: JwtPayload): Promise<RestaurantActor> {
    const [canVoid, canDiscount, canManageSessions] = await Promise.all([
      this.rbac.hasPermission(user.tenantId, user.sub, { module: M, screen: 'tickets', action: 'void' }),
      this.rbac.hasPermission(user.tenantId, user.sub, { module: M, screen: 'tickets', action: 'discount' }),
      this.rbac.hasPermission(user.tenantId, user.sub, { module: 'pos', screen: 'sessions', action: 'manage' }),
    ]);
    return { userId: user.sub, canVoid, canDiscount, canManageSessions };
  }

  @RequirePermissions({ module: M, screen: 'tickets', action: 'read' })
  @Get()
  findAll(@CurrentTenant() t: string, @Query() q: TicketQueryDto) {
    return this.tickets.findAll(t, q);
  }

  @RequirePermissions({ module: M, screen: 'tickets', action: 'create' })
  @Post()
  async create(@CurrentTenant() t: string, @CurrentUser() user: JwtPayload, @Body() dto: CreateTicketDto) {
    return this.tickets.create(t, await this.actor(user), dto);
  }

  @RequirePermissions({ module: M, screen: 'tickets', action: 'read' })
  @Get(':id')
  findById(@CurrentTenant() t: string, @Param('id') id: string) {
    return this.tickets.findById(t, id);
  }

  @RequirePermissions({ module: M, screen: 'tickets', action: 'update' })
  @Patch(':id')
  async update(
    @CurrentTenant() t: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateTicketDto,
  ) {
    return this.tickets.update(t, await this.actor(user), id, dto);
  }

  @RequirePermissions({ module: M, screen: 'tickets', action: 'update' })
  @Post(':id/lines')
  async addLines(
    @CurrentTenant() t: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: AddTicketLineDto,
  ) {
    return this.tickets.addLines(t, await this.actor(user), id, [dto]);
  }

  @RequirePermissions({ module: M, screen: 'tickets', action: 'update' })
  @Patch(':id/lines/:lineId')
  async updateLine(
    @CurrentTenant() t: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: UpdateTicketLineDto,
  ) {
    return this.tickets.updateLine(t, await this.actor(user), id, lineId, dto);
  }

  @RequirePermissions({ module: M, screen: 'tickets', action: 'update' })
  @Delete(':id/lines/:lineId')
  async removeLine(
    @CurrentTenant() t: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Query() q: ReasonDto,
  ) {
    return this.tickets.removeLine(t, await this.actor(user), id, lineId, q.reason);
  }

  @RequirePermissions({ module: M, screen: 'tickets', action: 'update' })
  @Post(':id/transfer')
  transfer(@CurrentTenant() t: string, @Param('id') id: string, @Body() dto: TransferTicketDto) {
    return this.tickets.transfer(t, id, dto.tableId);
  }

  @RequirePermissions({ module: M, screen: 'tickets', action: 'update' })
  @Post(':id/merge')
  async merge(
    @CurrentTenant() t: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: MergeTicketDto,
  ) {
    return this.tickets.merge(t, await this.actor(user), id, dto.targetTicketId);
  }

  @RequirePermissions({ module: M, screen: 'tickets', action: 'update' })
  @Post(':id/split')
  async split(
    @CurrentTenant() t: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: SplitTicketDto,
  ) {
    return this.tickets.split(t, await this.actor(user), id, dto);
  }

  @RequirePermissions({ module: M, screen: 'tickets', action: 'read' })
  @Get(':id/split-preview')
  splitPreview(@CurrentTenant() t: string, @Param('id') id: string, @Query() q: SplitPreviewQueryDto) {
    return this.tickets.splitPreview(t, id, q.ways);
  }

  @RequirePermissions({ module: M, screen: 'tickets', action: 'update' })
  @Post(':id/driver')
  assignDriver(@CurrentTenant() t: string, @Param('id') id: string, @Body() dto: AssignDriverDto) {
    return this.tickets.assignDriver(t, id, dto.driverId);
  }

  @RequirePermissions({ module: M, screen: 'tickets', action: 'void' })
  @Post(':id/void')
  async voidTicket(
    @CurrentTenant() t: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: VoidTicketDto,
  ) {
    return this.tickets.voidTicket(t, await this.actor(user), id, dto.reason);
  }

  @RequirePermissions({ module: M, screen: 'tickets', action: 'update' })
  @Post(':id/send-to-kitchen')
  async sendToKitchen(@CurrentTenant() t: string, @CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.tickets.sendToKitchen(t, await this.actor(user), id);
  }

  @RequirePermissions({ module: M, screen: 'tickets', action: 'read' })
  @Get(':id/kitchen-tickets')
  kitchenTickets(@CurrentTenant() t: string, @Param('id') id: string) {
    return this.kitchen.findForTicket(t, id);
  }

  @RequirePermissions({ module: M, screen: 'tickets', action: 'pay' })
  @Post(':id/pay')
  async pay(
    @CurrentTenant() t: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: PayTicketDto,
  ) {
    return this.tickets.pay(t, await this.actor(user), id, dto);
  }
}
