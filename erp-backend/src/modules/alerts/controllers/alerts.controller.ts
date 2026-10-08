import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { AlertsService } from '../services/alerts.service';
import { AlertDeliveryQueryDto, CreateAlertRuleDto, ScanAlertsDto, UpdateAlertRuleDto } from '../dto/alerts.dto';

@ApiTags('alerts')
@ApiBearerAuth()
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @RequirePermissions({ module: 'settings', screen: 'alerts', action: 'read' })
  @Get('types')
  @ApiOperation({ summary: 'Alert types with their thresholds and defaults' })
  types() {
    return this.alerts.types();
  }

  @RequirePermissions({ module: 'settings', screen: 'alerts', action: 'read' })
  @Get('rules')
  rules(@CurrentTenant() tenantId: string) {
    return this.alerts.findRules(tenantId);
  }

  @RequirePermissions({ module: 'settings', screen: 'alerts', action: 'create' })
  @Post('rules')
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateAlertRuleDto) {
    return this.alerts.createRule(tenantId, dto);
  }

  @RequirePermissions({ module: 'settings', screen: 'alerts', action: 'create' })
  @Post('rules/defaults')
  @ApiOperation({ summary: 'Create a default rule for every alert type not configured yet' })
  defaults(@CurrentTenant() tenantId: string) {
    return this.alerts.createDefaults(tenantId);
  }

  @RequirePermissions({ module: 'settings', screen: 'alerts', action: 'read' })
  @Get('rules/:id')
  rule(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.alerts.findRule(tenantId, id);
  }

  @RequirePermissions({ module: 'settings', screen: 'alerts', action: 'update' })
  @Patch('rules/:id')
  update(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAlertRuleDto,
  ) {
    return this.alerts.updateRule(tenantId, id, dto);
  }

  @RequirePermissions({ module: 'settings', screen: 'alerts', action: 'delete' })
  @Delete('rules/:id')
  remove(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.alerts.removeRule(tenantId, id);
  }

  @RequirePermissions({ module: 'settings', screen: 'alerts', action: 'update' })
  @Post('scan')
  @ApiOperation({ summary: 'Run the alert rules now (dryRun returns matches without notifying)' })
  scan(@CurrentTenant() tenantId: string, @Body() dto: ScanAlertsDto) {
    return this.alerts.scan(tenantId, dto);
  }

  @RequirePermissions({ module: 'settings', screen: 'alerts', action: 'read' })
  @Get('deliveries')
  @ApiOperation({ summary: 'Alerts sent (one row per record, user and day)' })
  deliveries(@CurrentTenant() tenantId: string, @Query() query: AlertDeliveryQueryDto) {
    return this.alerts.findDeliveries(tenantId, query);
  }
}
