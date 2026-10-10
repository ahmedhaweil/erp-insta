import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { KitchenService } from '../services/kitchen.service';
import { RestaurantReportsService } from '../services/restaurant-reports.service';
import {
  DriverReportQueryDto,
  KdsQueryDto,
  KitchenStatusDto,
  PeriodQueryDto,
  VoidLogQueryDto,
} from '../dto/restaurant.dto';

const M = 'restaurant';

@ApiTags('restaurant')
@ApiBearerAuth()
@Controller('restaurant/kitchen')
export class KitchenController {
  constructor(private readonly kitchen: KitchenService) {}

  @RequirePermissions({ module: M, screen: 'kitchen', action: 'read' })
  @Get('kds')
  kds(@CurrentTenant() t: string, @Query() q: KdsQueryDto) {
    return this.kitchen.kds(t, q.stationId);
  }

  @RequirePermissions({ module: M, screen: 'kitchen', action: 'update' })
  @Post('tickets/:id/status')
  setStatus(@CurrentTenant() t: string, @Param('id') id: string, @Body() dto: KitchenStatusDto) {
    return this.kitchen.setStatus(t, id, dto.status);
  }
}

@ApiTags('restaurant')
@ApiBearerAuth()
@Controller('restaurant/reports')
export class RestaurantReportsController {
  constructor(private readonly reports: RestaurantReportsService) {}

  @RequirePermissions({ module: M, screen: 'reports', action: 'read' })
  @Get('driver-commissions')
  driverCommissions(@CurrentTenant() t: string, @Query() q: DriverReportQueryDto) {
    return this.reports.driverCommissions(t, q);
  }

  @RequirePermissions({ module: M, screen: 'reports', action: 'read' })
  @Get('delivery-apps')
  appSales(@CurrentTenant() t: string, @Query() q: PeriodQueryDto) {
    return this.reports.appSales(t, q);
  }

  @RequirePermissions({ module: M, screen: 'reports', action: 'read' })
  @Get('void-log')
  voidLog(@CurrentTenant() t: string, @Query() q: VoidLogQueryDto) {
    return this.reports.voidLog(t, q);
  }

  @RequirePermissions({ module: M, screen: 'reports', action: 'read' })
  @Get('table-turnover')
  tableTurnover(@CurrentTenant() t: string, @Query() q: PeriodQueryDto) {
    return this.reports.tableTurnover(t, q);
  }

  @RequirePermissions({ module: M, screen: 'reports', action: 'read' })
  @Get('kitchen-times')
  kitchenTimes(@CurrentTenant() t: string, @Query() q: PeriodQueryDto) {
    return this.reports.kitchenTimes(t, q);
  }
}
