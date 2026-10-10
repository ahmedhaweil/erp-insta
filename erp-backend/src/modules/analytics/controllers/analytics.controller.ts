import { Body, Controller, Get, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { ReportExportService } from '@modules/reports/export/report-export.service';
import { AnalyticsQueryDto, UpdateAnalyticsSettingsDto } from '../dto/analytics.dto';
import { AnalyticsService } from '../services/analytics.service';
import { AlertsService } from '../services/alerts.service';
import { AnalyticsSettingsService } from '../services/analytics-settings.service';
import { AnalyticsSpecName, analyticsSpecs } from '../export/analytics-specs';
import { stripProfit } from '../services/analytics-calculator';

const DASHBOARD = { module: 'analytics', screen: 'dashboard', action: 'read' };

/**
 * Business analytics (Instasoft التحليلات): KPIs, stock health, item /
 * category / customer performance, purchase suggestions, insights, alerts.
 * Profit, cost, margin and stock value fields need analytics/profit/read.
 * List endpoints accept ?format=xlsx and ?lang=ar|en.
 */
@ApiTags('analytics')
@ApiBearerAuth()
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly alerts: AlertsService,
    private readonly settings: AnalyticsSettingsService,
    private readonly exporter: ReportExportService,
  ) {}

  private async list(
    tenantId: string,
    user: JwtPayload,
    q: AnalyticsQueryDto,
    name: AnalyticsSpecName,
    compute: (ctx: Awaited<ReturnType<AnalyticsService['context']>>) => Promise<unknown>,
  ) {
    const canSee = await this.analytics.canSeeProfit(tenantId, user.sub);
    const ctx = await this.analytics.context(tenantId, q);
    const raw = await compute(ctx);
    const data = canSee ? raw : stripProfit(raw);
    return this.exporter.respond(q.format, q.lang, data, (d) => analyticsSpecs[name](d, canSee));
  }

  private async plain(tenantId: string, user: JwtPayload, q: AnalyticsQueryDto, compute: (ctx: any) => Promise<unknown>) {
    const ctx = await this.analytics.context(tenantId, q);
    return this.analytics.visible(tenantId, user.sub, await compute(ctx));
  }

  @ApiOperation({ summary: 'Dashboard: KPIs, top items/customers and daily trend' })
  @RequirePermissions(DASHBOARD)
  @Get('dashboard')
  dashboard(@CurrentTenant() t: string, @CurrentUser() u: JwtPayload, @Query() q: AnalyticsQueryDto) {
    return this.plain(t, u, q, (ctx) => this.analytics.dashboard(ctx));
  }

  @ApiOperation({ summary: 'KPIs with previous-period values and change %' })
  @RequirePermissions(DASHBOARD)
  @Get('kpi')
  kpi(@CurrentTenant() t: string, @CurrentUser() u: JwtPayload, @Query() q: AnalyticsQueryDto) {
    return this.plain(t, u, q, (ctx) => this.analytics.kpi(ctx));
  }

  @ApiOperation({ summary: 'Slow-moving / dead stock (in stock, not sold for stagnationDays)' })
  @RequirePermissions(DASHBOARD)
  @Get('slow-moving')
  slowMoving(@CurrentTenant() t: string, @CurrentUser() u: JwtPayload, @Query() q: AnalyticsQueryDto) {
    return this.list(t, u, q, 'slowMoving', (ctx) => this.analytics.slowMoving(ctx));
  }

  @ApiOperation({ summary: 'Low stock by reorder level and days of cover' })
  @RequirePermissions(DASHBOARD)
  @Get('low-stock')
  lowStock(@CurrentTenant() t: string, @CurrentUser() u: JwtPayload, @Query() q: AnalyticsQueryDto) {
    return this.list(t, u, q, 'lowStock', (ctx) => this.analytics.lowStock(ctx));
  }

  @ApiOperation({ summary: 'Overstock (days of cover ≥ overstockDays)' })
  @RequirePermissions(DASHBOARD)
  @Get('overstock')
  overstock(@CurrentTenant() t: string, @CurrentUser() u: JwtPayload, @Query() q: AnalyticsQueryDto) {
    return this.list(t, u, q, 'overstock', (ctx) => this.analytics.overstock(ctx));
  }

  @ApiOperation({ summary: 'Item performance vs previous period with derived lists (top, quadrants, declining)' })
  @RequirePermissions(DASHBOARD)
  @Get('items')
  items(@CurrentTenant() t: string, @CurrentUser() u: JwtPayload, @Query() q: AnalyticsQueryDto) {
    return this.list(t, u, q, 'items', async (ctx) => {
      const data = await this.analytics.items(ctx);
      if (await this.analytics.canSeeProfit(t, u.sub)) return data;
      // margin-based lists reveal profit
      return { ...data, topProfit: [], highSalesLowMargin: [], highMarginLowSales: [], profitLosers: [] };
    });
  }

  @ApiOperation({ summary: 'Category performance vs previous period' })
  @RequirePermissions(DASHBOARD)
  @Get('categories')
  categories(@CurrentTenant() t: string, @CurrentUser() u: JwtPayload, @Query() q: AnalyticsQueryDto) {
    return this.list(t, u, q, 'categories', (ctx) => this.analytics.categories(ctx));
  }

  @ApiOperation({ summary: 'Consumption-based purchase suggestions (rate × coverDays − stock − open POs)' })
  @RequirePermissions(DASHBOARD)
  @Get('purchase-suggestions')
  purchaseSuggestions(@CurrentTenant() t: string, @CurrentUser() u: JwtPayload, @Query() q: AnalyticsQueryDto) {
    return this.list(t, u, q, 'purchaseSuggestions', (ctx) => this.analytics.purchaseSuggestions(ctx));
  }

  @ApiOperation({ summary: 'Top, lost and stagnant customers and concentration' })
  @RequirePermissions(DASHBOARD)
  @Get('customers')
  customers(@CurrentTenant() t: string, @CurrentUser() u: JwtPayload, @Query() q: AnalyticsQueryDto) {
    return this.list(t, u, q, 'customers', (ctx) => this.analytics.customers(ctx));
  }

  @ApiOperation({ summary: 'Returns per product with return % of sales' })
  @RequirePermissions(DASHBOARD)
  @Get('returns')
  returns(@CurrentTenant() t: string, @CurrentUser() u: JwtPayload, @Query() q: AnalyticsQueryDto) {
    return this.list(t, u, q, 'returns', (ctx) => this.analytics.returns(ctx));
  }

  @ApiOperation({ summary: 'Daily sales trend' })
  @RequirePermissions(DASHBOARD)
  @Get('daily-sales')
  dailySales(@CurrentTenant() t: string, @CurrentUser() u: JwtPayload, @Query() q: AnalyticsQueryDto) {
    return this.list(t, u, q, 'dailySales', (ctx) => this.analytics.dailySales(ctx));
  }

  @ApiOperation({ summary: 'Sales by user (count, sales, discounts, average)' })
  @RequirePermissions(DASHBOARD)
  @Get('users')
  users(@CurrentTenant() t: string, @CurrentUser() u: JwtPayload, @Query() q: AnalyticsQueryDto) {
    return this.list(t, u, q, 'users', (ctx) => this.analytics.salesByUser(ctx));
  }

  @ApiOperation({ summary: 'Rule-based insight cards sorted by severity' })
  @RequirePermissions({ module: 'analytics', screen: 'insights', action: 'read' })
  @Get('insights')
  async insights(@CurrentTenant() t: string, @CurrentUser() u: JwtPayload, @Query() q: AnalyticsQueryDto) {
    const canSee = await this.analytics.canSeeProfit(t, u.sub);
    const ctx = await this.analytics.context(t, q);
    return this.analytics.insights(ctx, canSee);
  }

  @ApiOperation({ summary: 'Alerts evaluated live from the tenant alert settings' })
  @RequirePermissions({ module: 'analytics', screen: 'alerts', action: 'read' })
  @Get('alerts')
  async getAlerts(@CurrentTenant() t: string, @CurrentUser() u: JwtPayload) {
    return this.analytics.visible(t, u.sub, await this.alerts.evaluate(t));
  }

  @ApiOperation({ summary: 'Evaluate alerts and create notifications (once per alert, user and day)' })
  @RequirePermissions({ module: 'analytics', screen: 'alerts', action: 'create' })
  @Post('alerts/run')
  runAlerts(@CurrentTenant() t: string) {
    return this.alerts.run(t);
  }

  @ApiOperation({ summary: 'Analytics thresholds and alert settings' })
  @RequirePermissions({ module: 'analytics', screen: 'alerts', action: 'read' })
  @Get('settings')
  getSettings(@CurrentTenant() t: string) {
    return this.settings.get(t);
  }

  @ApiOperation({ summary: 'Update analytics thresholds and alert settings' })
  @RequirePermissions({ module: 'analytics', screen: 'alerts', action: 'update' })
  @Put('settings')
  updateSettings(@CurrentTenant() t: string, @Body() dto: UpdateAnalyticsSettingsDto) {
    return this.settings.update(t, dto);
  }
}
