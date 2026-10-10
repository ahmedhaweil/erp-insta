import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FuelActor, FuelService } from '../services/fuel.service';
import {
  CloseShiftDto,
  CreateNozzleDto,
  CreatePumpDto,
  CreateTankDto,
  FuelPeriodDto,
  FuelSalesReportDto,
  MeterAdjustmentDto,
  OpenShiftDto,
  ShiftQueryDto,
  TankDipDto,
  UpdateNozzleDto,
  UpdatePumpDto,
  UpdateTankDto,
} from '../dto/fuel.dto';
import { RbacService } from '@modules/auth/services/rbac.service';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { addDays, today } from '@shared/utils/document-totals.util';

const F = 'fuel';
const COST_FIELDS = ['unitCost', 'cost', 'margin', 'totalCost', 'totalMargin'];

/** Removes cost and margin fields (recursively) for users without fuel/shifts/costs. */
export function stripCosts<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripCosts(v)) as any;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: any = {};
    for (const [k, v] of Object.entries(value as any)) {
      if (COST_FIELDS.includes(k)) continue;
      out[k] = stripCosts(v);
    }
    return out;
  }
  return value;
}

@ApiTags('fuel')
@ApiBearerAuth()
@Controller('fuel')
export class FuelController {
  constructor(
    private readonly service: FuelService,
    private readonly rbac: RbacService,
  ) {}

  private canSeeCosts(user: JwtPayload) {
    return this.rbac.hasPermission(user.tenantId, user.sub, { module: F, screen: 'shifts', action: 'costs' });
  }

  private async withCosts<T>(user: JwtPayload, value: Promise<T>): Promise<T> {
    const [result, allowed] = await Promise.all([value, this.canSeeCosts(user)]);
    return allowed ? result : stripCosts(result);
  }

  private async actor(user: JwtPayload): Promise<FuelActor> {
    const canManageShifts = await this.rbac.hasPermission(user.tenantId, user.sub, {
      module: F,
      screen: 'shifts',
      action: 'manage',
    });
    return { userId: user.sub, canManageShifts };
  }

  // tanks
  @RequirePermissions({ module: F, screen: 'setup', action: 'read' })
  @Get('tanks')
  findTanks(@CurrentTenant() tenantId: string, @Query('withStock') withStock?: string) {
    return this.service.findTanks(tenantId, withStock === 'true');
  }

  @RequirePermissions({ module: F, screen: 'setup', action: 'create' })
  @Post('tanks')
  createTank(@CurrentTenant() tenantId: string, @Body() dto: CreateTankDto) {
    return this.service.createTank(tenantId, dto);
  }

  @RequirePermissions({ module: F, screen: 'setup', action: 'update' })
  @Patch('tanks/:id')
  updateTank(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: UpdateTankDto) {
    return this.service.updateTank(tenantId, id, dto);
  }

  @RequirePermissions({ module: F, screen: 'dips', action: 'read' })
  @Get('tanks/alerts')
  lowLevelAlerts(@CurrentTenant() tenantId: string) {
    return this.service.lowLevelAlerts(tenantId);
  }

  @RequirePermissions({ module: F, screen: 'dips', action: 'create' })
  @Post('tanks/:id/dips')
  recordDip(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: TankDipDto,
  ) {
    return this.service.recordDip(tenantId, user.sub, id, dto);
  }

  @RequirePermissions({ module: F, screen: 'dips', action: 'read' })
  @Get('tanks/:id/dips')
  findDips(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.findDips(tenantId, id);
  }

  // pumps & nozzles
  @RequirePermissions({ module: F, screen: 'setup', action: 'read' })
  @Get('pumps')
  findPumps(@CurrentTenant() tenantId: string) {
    return this.service.findPumps(tenantId);
  }

  @RequirePermissions({ module: F, screen: 'setup', action: 'create' })
  @Post('pumps')
  createPump(@CurrentTenant() tenantId: string, @Body() dto: CreatePumpDto) {
    return this.service.createPump(tenantId, dto);
  }

  @RequirePermissions({ module: F, screen: 'setup', action: 'update' })
  @Patch('pumps/:id')
  updatePump(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: UpdatePumpDto) {
    return this.service.updatePump(tenantId, id, dto);
  }

  @RequirePermissions({ module: F, screen: 'setup', action: 'read' })
  @Get('nozzles')
  findNozzles(@CurrentTenant() tenantId: string) {
    return this.service.findNozzles(tenantId);
  }

  @RequirePermissions({ module: F, screen: 'setup', action: 'create' })
  @Post('nozzles')
  createNozzle(@CurrentTenant() tenantId: string, @Body() dto: CreateNozzleDto) {
    return this.service.createNozzle(tenantId, dto);
  }

  @RequirePermissions({ module: F, screen: 'setup', action: 'update' })
  @Patch('nozzles/:id')
  updateNozzle(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: UpdateNozzleDto) {
    return this.service.updateNozzle(tenantId, id, dto);
  }

  @RequirePermissions({ module: F, screen: 'meters', action: 'update' })
  @Post('nozzles/:id/meter-adjustments')
  adjustMeter(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: MeterAdjustmentDto,
  ) {
    return this.service.adjustMeter(tenantId, user.sub, id, dto);
  }

  @RequirePermissions({ module: F, screen: 'meters', action: 'read' })
  @Get('meter-adjustments')
  findMeterAdjustments(@CurrentTenant() tenantId: string, @Query('nozzleId') nozzleId?: string) {
    return this.service.findMeterAdjustments(tenantId, nozzleId);
  }

  // shifts
  @RequirePermissions({ module: F, screen: 'shifts', action: 'read' })
  @Get('shifts')
  findShifts(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Query() q: ShiftQueryDto) {
    return this.withCosts(user, this.service.findShifts(tenantId, q));
  }

  @RequirePermissions({ module: F, screen: 'shifts', action: 'create' })
  @Post('shifts/open')
  openShift(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Body() dto: OpenShiftDto) {
    return this.withCosts(user, this.service.openShift(tenantId, user.sub, dto));
  }

  @RequirePermissions({ module: F, screen: 'shifts', action: 'read' })
  @Get('shifts/:id')
  findShift(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.withCosts(user, this.service.findShift(tenantId, id));
  }

  @RequirePermissions({ module: F, screen: 'shifts', action: 'update' })
  @Post('shifts/:id/close')
  async closeShift(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CloseShiftDto,
  ) {
    return this.withCosts(user, this.service.closeShift(tenantId, await this.actor(user), id, dto));
  }

  @RequirePermissions({ module: F, screen: 'reports', action: 'read' })
  @Get('shifts/:id/report')
  shiftReport(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.withCosts(user, this.service.shiftReport(tenantId, id));
  }

  // reports
  @RequirePermissions({ module: F, screen: 'reports', action: 'read' })
  @Get('reports/sales')
  salesReport(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Query() q: FuelSalesReportDto) {
    const to = q.to ?? today();
    return this.withCosts(user, this.service.salesReport(tenantId, q.from ?? addDays(to, -30), to, q.groupBy));
  }

  @RequirePermissions({ module: F, screen: 'reports', action: 'read' })
  @Get('reports/tank-reconciliation/:tankId')
  tankReconciliation(@CurrentTenant() tenantId: string, @Param('tankId') tankId: string, @Query() q: FuelPeriodDto) {
    const to = q.to ?? today();
    return this.service.tankReconciliation(tenantId, tankId, q.from ?? addDays(to, -30), to);
  }
}
