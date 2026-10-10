import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MaintenanceService } from '../services/maintenance.service';
import {
  AddLabourDto,
  AddPartDto,
  ApprovalDto,
  ChangeStatusDto,
  CreateTechnicianDto,
  CreateTicketDto,
  DateRangeDto,
  InvoiceTicketDto,
  RescheduleDto,
  TicketQueryDto,
  UpdateMaintenanceSettingsDto,
  UpdateTechnicianDto,
  UpdateTicketDto,
} from '../dto/maintenance.dto';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { addDays, today } from '@shared/utils/document-totals.util';

const M = 'maintenance';

@ApiTags('maintenance')
@ApiBearerAuth()
@Controller('maintenance')
export class MaintenanceController {
  constructor(private readonly service: MaintenanceService) {}

  // technicians
  @RequirePermissions({ module: M, screen: 'technicians', action: 'read' })
  @Get('technicians')
  findTechnicians(@CurrentTenant() tenantId: string, @Query('activeOnly') activeOnly?: string) {
    return this.service.findTechnicians(tenantId, activeOnly === 'true');
  }

  @RequirePermissions({ module: M, screen: 'technicians', action: 'create' })
  @Post('technicians')
  createTechnician(@CurrentTenant() tenantId: string, @Body() dto: CreateTechnicianDto) {
    return this.service.createTechnician(tenantId, dto);
  }

  @RequirePermissions({ module: M, screen: 'technicians', action: 'update' })
  @Patch('technicians/:id')
  updateTechnician(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: UpdateTechnicianDto) {
    return this.service.updateTechnician(tenantId, id, dto);
  }

  // settings
  @RequirePermissions({ module: M, screen: 'settings', action: 'read' })
  @Get('settings')
  getSettings(@CurrentTenant() tenantId: string) {
    return this.service.getSettings(tenantId);
  }

  @RequirePermissions({ module: M, screen: 'settings', action: 'update' })
  @Put('settings')
  updateSettings(@CurrentTenant() tenantId: string, @Body() dto: UpdateMaintenanceSettingsDto) {
    return this.service.updateSettings(tenantId, dto);
  }

  // calendar & reports (before tickets/:id)
  @RequirePermissions({ module: M, screen: 'tickets', action: 'read' })
  @Get('calendar')
  calendar(@CurrentTenant() tenantId: string, @Query() q: DateRangeDto) {
    const from = q.from ?? today();
    return this.service.calendar(tenantId, from, q.to ?? addDays(from, 30));
  }

  @RequirePermissions({ module: M, screen: 'tickets', action: 'read' })
  @Get('overdue')
  overdue(@CurrentTenant() tenantId: string) {
    return this.service.overdue(tenantId);
  }

  @RequirePermissions({ module: M, screen: 'tickets', action: 'read' })
  @Get('workload')
  workload(@CurrentTenant() tenantId: string) {
    return this.service.workload(tenantId);
  }

  @RequirePermissions({ module: M, screen: 'reports', action: 'read' })
  @Get('reports/summary')
  report(@CurrentTenant() tenantId: string, @Query() q: DateRangeDto) {
    const to = q.to ?? today();
    return this.service.report(tenantId, q.from ?? addDays(to, -30), to);
  }

  // tickets
  @RequirePermissions({ module: M, screen: 'tickets', action: 'read' })
  @Get('tickets')
  findTickets(@CurrentTenant() tenantId: string, @Query() q: TicketQueryDto) {
    return this.service.findTickets(tenantId, q);
  }

  @RequirePermissions({ module: M, screen: 'tickets', action: 'create' })
  @Post('tickets')
  createTicket(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Body() dto: CreateTicketDto) {
    return this.service.createTicket(tenantId, user.sub, dto);
  }

  @RequirePermissions({ module: M, screen: 'tickets', action: 'read' })
  @Get('tickets/:id')
  findTicket(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.findTicket(tenantId, id);
  }

  @RequirePermissions({ module: M, screen: 'tickets', action: 'update' })
  @Patch('tickets/:id')
  updateTicket(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: UpdateTicketDto) {
    return this.service.updateTicket(tenantId, id, dto);
  }

  @RequirePermissions({ module: M, screen: 'tickets', action: 'update' })
  @Post('tickets/:id/status')
  changeStatus(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ChangeStatusDto,
  ) {
    return this.service.changeStatus(tenantId, user.sub, id, dto);
  }

  @RequirePermissions({ module: M, screen: 'tickets', action: 'update' })
  @Post('tickets/:id/reschedule')
  reschedule(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: RescheduleDto,
  ) {
    return this.service.reschedule(tenantId, user.sub, id, dto);
  }

  @RequirePermissions({ module: M, screen: 'tickets', action: 'update' })
  @Post('tickets/:id/approval')
  setApproval(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ApprovalDto,
  ) {
    return this.service.setApproval(tenantId, user.sub, id, dto);
  }

  @RequirePermissions({ module: M, screen: 'tickets', action: 'update' })
  @Post('tickets/:id/parts')
  addPart(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: AddPartDto) {
    return this.service.addPart(tenantId, id, dto);
  }

  @RequirePermissions({ module: M, screen: 'tickets', action: 'update' })
  @Delete('tickets/:id/parts/:partId')
  removePart(@CurrentTenant() tenantId: string, @Param('id') id: string, @Param('partId') partId: string) {
    return this.service.removePart(tenantId, id, partId);
  }

  @RequirePermissions({ module: M, screen: 'tickets', action: 'update' })
  @Post('tickets/:id/labour')
  addLabour(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: AddLabourDto) {
    return this.service.addLabour(tenantId, id, dto);
  }

  @RequirePermissions({ module: M, screen: 'tickets', action: 'update' })
  @Delete('tickets/:id/labour/:labourId')
  removeLabour(@CurrentTenant() tenantId: string, @Param('id') id: string, @Param('labourId') labourId: string) {
    return this.service.removeLabour(tenantId, id, labourId);
  }

  @RequirePermissions(
    { module: M, screen: 'tickets', action: 'update' },
    { module: 'sales', screen: 'invoices', action: 'create' },
  )
  @Post('tickets/:id/invoice')
  invoice(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: InvoiceTicketDto,
  ) {
    return this.service.invoice(tenantId, user.sub, id, dto);
  }
}
