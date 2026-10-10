import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { RestaurantMasterService } from '../services/restaurant-master.service';
import {
  CreateComboGroupDto,
  CreateDeliveryAppDto,
  CreateDiningAreaDto,
  CreateDriverDto,
  CreateModifierDto,
  CreateStationDto,
  CreateTableDto,
  CreateZoneDto,
  SetAppPricesDto,
  SetRoutesDto,
  UpdateComboGroupDto,
  UpdateDeliveryAppDto,
  UpdateDiningAreaDto,
  UpdateDriverDto,
  UpdateModifierDto,
  UpdateRestaurantSettingsDto,
  UpdateStationDto,
  UpdateTableDto,
  UpdateZoneDto,
} from '../dto/restaurant.dto';

const M = 'restaurant';

@ApiTags('restaurant')
@ApiBearerAuth()
@Controller('restaurant')
export class RestaurantMasterController {
  constructor(private readonly master: RestaurantMasterService) {}

  // areas
  @RequirePermissions({ module: M, screen: 'areas', action: 'read' })
  @Get('areas')
  findAreas(@CurrentTenant() t: string) {
    return this.master.findAreas(t);
  }

  @RequirePermissions({ module: M, screen: 'areas', action: 'create' })
  @Post('areas')
  createArea(@CurrentTenant() t: string, @Body() dto: CreateDiningAreaDto) {
    return this.master.createArea(t, dto);
  }

  @RequirePermissions({ module: M, screen: 'areas', action: 'update' })
  @Patch('areas/:id')
  updateArea(@CurrentTenant() t: string, @Param('id') id: string, @Body() dto: UpdateDiningAreaDto) {
    return this.master.updateArea(t, id, dto);
  }

  // tables
  @RequirePermissions({ module: M, screen: 'tables', action: 'read' })
  @ApiQuery({ name: 'areaId', required: false })
  @Get('tables')
  findTables(@CurrentTenant() t: string, @Query('areaId') areaId?: string) {
    return this.master.findTables(t, areaId);
  }

  @RequirePermissions({ module: M, screen: 'tables', action: 'create' })
  @Post('tables')
  createTable(@CurrentTenant() t: string, @Body() dto: CreateTableDto) {
    return this.master.createTable(t, dto);
  }

  @RequirePermissions({ module: M, screen: 'tables', action: 'update' })
  @Patch('tables/:id')
  updateTable(@CurrentTenant() t: string, @Param('id') id: string, @Body() dto: UpdateTableDto) {
    return this.master.updateTable(t, id, dto);
  }

  // zones
  @RequirePermissions({ module: M, screen: 'zones', action: 'read' })
  @Get('zones')
  findZones(@CurrentTenant() t: string) {
    return this.master.findZones(t);
  }

  @RequirePermissions({ module: M, screen: 'zones', action: 'create' })
  @Post('zones')
  createZone(@CurrentTenant() t: string, @Body() dto: CreateZoneDto) {
    return this.master.createZone(t, dto);
  }

  @RequirePermissions({ module: M, screen: 'zones', action: 'update' })
  @Patch('zones/:id')
  updateZone(@CurrentTenant() t: string, @Param('id') id: string, @Body() dto: UpdateZoneDto) {
    return this.master.updateZone(t, id, dto);
  }

  // drivers
  @RequirePermissions({ module: M, screen: 'drivers', action: 'read' })
  @Get('drivers')
  findDrivers(@CurrentTenant() t: string) {
    return this.master.findDrivers(t);
  }

  @RequirePermissions({ module: M, screen: 'drivers', action: 'create' })
  @Post('drivers')
  createDriver(@CurrentTenant() t: string, @Body() dto: CreateDriverDto) {
    return this.master.createDriver(t, dto);
  }

  @RequirePermissions({ module: M, screen: 'drivers', action: 'update' })
  @Patch('drivers/:id')
  updateDriver(@CurrentTenant() t: string, @Param('id') id: string, @Body() dto: UpdateDriverDto) {
    return this.master.updateDriver(t, id, dto);
  }

  // delivery apps
  @RequirePermissions({ module: M, screen: 'apps', action: 'read' })
  @Get('apps')
  findApps(@CurrentTenant() t: string) {
    return this.master.findApps(t);
  }

  @RequirePermissions({ module: M, screen: 'apps', action: 'create' })
  @Post('apps')
  createApp(@CurrentTenant() t: string, @Body() dto: CreateDeliveryAppDto) {
    return this.master.createApp(t, dto);
  }

  @RequirePermissions({ module: M, screen: 'apps', action: 'update' })
  @Patch('apps/:id')
  updateApp(@CurrentTenant() t: string, @Param('id') id: string, @Body() dto: UpdateDeliveryAppDto) {
    return this.master.updateApp(t, id, dto);
  }

  @RequirePermissions({ module: M, screen: 'apps', action: 'read' })
  @Get('apps/:id/prices')
  findAppPrices(@CurrentTenant() t: string, @Param('id') id: string) {
    return this.master.findAppPrices(t, id);
  }

  @RequirePermissions({ module: M, screen: 'apps', action: 'update' })
  @Put('apps/:id/prices')
  setAppPrices(@CurrentTenant() t: string, @Param('id') id: string, @Body() dto: SetAppPricesDto) {
    return this.master.setAppPrices(t, id, dto);
  }

  @RequirePermissions({ module: M, screen: 'apps', action: 'update' })
  @Delete('apps/:id/prices/:productId')
  removeAppPrice(@CurrentTenant() t: string, @Param('id') id: string, @Param('productId') productId: string) {
    return this.master.removeAppPrice(t, id, productId);
  }

  // kitchen stations & routing
  @RequirePermissions({ module: M, screen: 'stations', action: 'read' })
  @Get('stations')
  findStations(@CurrentTenant() t: string) {
    return this.master.findStations(t);
  }

  @RequirePermissions({ module: M, screen: 'stations', action: 'create' })
  @Post('stations')
  createStation(@CurrentTenant() t: string, @Body() dto: CreateStationDto) {
    return this.master.createStation(t, dto);
  }

  @RequirePermissions({ module: M, screen: 'stations', action: 'update' })
  @Patch('stations/:id')
  updateStation(@CurrentTenant() t: string, @Param('id') id: string, @Body() dto: UpdateStationDto) {
    return this.master.updateStation(t, id, dto);
  }

  @RequirePermissions({ module: M, screen: 'stations', action: 'read' })
  @Get('kitchen-routes')
  findRoutes(@CurrentTenant() t: string) {
    return this.master.findRoutes(t);
  }

  @RequirePermissions({ module: M, screen: 'stations', action: 'update' })
  @Put('kitchen-routes')
  setRoutes(@CurrentTenant() t: string, @Body() dto: SetRoutesDto) {
    return this.master.setRoutes(t, dto);
  }

  // modifiers & combos
  @RequirePermissions({ module: M, screen: 'modifiers', action: 'read' })
  @ApiQuery({ name: 'productId', required: false })
  @Get('modifiers')
  findModifiers(@CurrentTenant() t: string, @Query('productId') productId?: string) {
    return this.master.findModifiers(t, productId);
  }

  @RequirePermissions({ module: M, screen: 'modifiers', action: 'create' })
  @Post('modifiers')
  createModifier(@CurrentTenant() t: string, @Body() dto: CreateModifierDto) {
    return this.master.createModifier(t, dto);
  }

  @RequirePermissions({ module: M, screen: 'modifiers', action: 'update' })
  @Patch('modifiers/:id')
  updateModifier(@CurrentTenant() t: string, @Param('id') id: string, @Body() dto: UpdateModifierDto) {
    return this.master.updateModifier(t, id, dto);
  }

  @RequirePermissions({ module: M, screen: 'modifiers', action: 'delete' })
  @Delete('modifiers/:id')
  removeModifier(@CurrentTenant() t: string, @Param('id') id: string) {
    return this.master.removeModifier(t, id);
  }

  @RequirePermissions({ module: M, screen: 'modifiers', action: 'read' })
  @ApiQuery({ name: 'comboProductId', required: false })
  @Get('combo-groups')
  findComboGroups(@CurrentTenant() t: string, @Query('comboProductId') comboProductId?: string) {
    return this.master.findComboGroups(t, comboProductId);
  }

  @RequirePermissions({ module: M, screen: 'modifiers', action: 'create' })
  @Post('combo-groups')
  createComboGroup(@CurrentTenant() t: string, @Body() dto: CreateComboGroupDto) {
    return this.master.createComboGroup(t, dto);
  }

  @RequirePermissions({ module: M, screen: 'modifiers', action: 'update' })
  @Patch('combo-groups/:id')
  updateComboGroup(@CurrentTenant() t: string, @Param('id') id: string, @Body() dto: UpdateComboGroupDto) {
    return this.master.updateComboGroup(t, id, dto);
  }

  @RequirePermissions({ module: M, screen: 'modifiers', action: 'delete' })
  @Delete('combo-groups/:id')
  removeComboGroup(@CurrentTenant() t: string, @Param('id') id: string) {
    return this.master.removeComboGroup(t, id);
  }

  // settings
  @RequirePermissions({ module: M, screen: 'settings', action: 'read' })
  @Get('settings')
  getSettings(@CurrentTenant() t: string) {
    return this.master.getSettings(t);
  }

  @RequirePermissions({ module: M, screen: 'settings', action: 'update' })
  @Patch('settings')
  updateSettings(@CurrentTenant() t: string, @Body() dto: UpdateRestaurantSettingsDto) {
    return this.master.updateSettings(t, dto);
  }
}
