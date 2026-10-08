import { Controller, Get, Post, Put, Delete, Body, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { TaxService } from '../services/tax.service';
import { ComplianceSettingsService } from '../services/compliance-settings.service';
import { ItemCodesService } from '../services/item-codes.service';
import { CreateTaxConfigDto } from '../dto/create-tax-config.dto';
import { UpdateComplianceSettingsDto } from '../dto/compliance-settings.dto';
import { UpdateItemCodeDto, UpsertItemCodeDto } from '../dto/item-code.dto';
import { UpsertCompliancePartyDto } from '../dto/compliance-party.dto';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';

/** Compliance configuration: tax rates, ETA/ZATCA settings, item codes, parties. */
@ApiTags('compliance')
@ApiBearerAuth()
@Controller('compliance')
export class ComplianceController {
  constructor(
    private readonly taxService: TaxService,
    private readonly settingsService: ComplianceSettingsService,
    private readonly itemCodes: ItemCodesService,
  ) {}

  @RequirePermissions({ module: 'compliance', screen: 'settings', action: 'read' })
  @Get('tax-configs')
  getTaxConfigs(@CurrentTenant() tenantId: string) {
    return this.taxService.getTaxConfigs(tenantId);
  }

  @RequirePermissions({ module: 'compliance', screen: 'settings', action: 'create' })
  @Post('tax-configs')
  createTaxConfig(@CurrentTenant() tenantId: string, @Body() dto: CreateTaxConfigDto) {
    return this.taxService.createTaxConfig(tenantId, dto);
  }

  // ---- settings --------------------------------------------------------------

  @ApiOperation({ summary: 'ETA / ZATCA settings of the tenant (secrets masked)' })
  @RequirePermissions({ module: 'compliance', screen: 'settings', action: 'read' })
  @Get('settings')
  getSettings(@CurrentTenant() tenantId: string) {
    return this.settingsService.getView(tenantId);
  }

  @ApiOperation({ summary: 'Update settings (omit secrets to keep them, empty string clears)' })
  @RequirePermissions({ module: 'compliance', screen: 'settings', action: 'update' })
  @Put('settings')
  updateSettings(@CurrentTenant() tenantId: string, @Body() dto: UpdateComplianceSettingsDto) {
    return this.settingsService.update(tenantId, dto);
  }

  // ---- item code mapping -------------------------------------------------------

  @RequirePermissions({ module: 'compliance', screen: 'settings', action: 'read' })
  @Get('item-codes')
  listItemCodes(@CurrentTenant() tenantId: string) {
    return this.itemCodes.findAll(tenantId);
  }

  @RequirePermissions({ module: 'compliance', screen: 'settings', action: 'read' })
  @Get('item-codes/:id')
  getItemCode(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.itemCodes.findById(tenantId, id);
  }

  @ApiOperation({ summary: 'Create or replace the ETA item code of a product' })
  @RequirePermissions({ module: 'compliance', screen: 'settings', action: 'create' })
  @Post('item-codes')
  upsertItemCode(@CurrentTenant() tenantId: string, @Body() dto: UpsertItemCodeDto) {
    return this.itemCodes.upsert(tenantId, dto);
  }

  @RequirePermissions({ module: 'compliance', screen: 'settings', action: 'update' })
  @Put('item-codes/:id')
  updateItemCode(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateItemCodeDto,
  ) {
    return this.itemCodes.update(tenantId, id, dto);
  }

  @RequirePermissions({ module: 'compliance', screen: 'settings', action: 'delete' })
  @Delete('item-codes/:id')
  deleteItemCode(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.itemCodes.remove(tenantId, id);
  }

  // ---- customer (receiver / buyer) profiles ---------------------------------------

  @RequirePermissions({ module: 'compliance', screen: 'settings', action: 'read' })
  @Get('parties/:customerId')
  getParty(@CurrentTenant() tenantId: string, @Param('customerId', ParseUUIDPipe) customerId: string) {
    return this.settingsService.findParty(tenantId, customerId);
  }

  @ApiOperation({ summary: 'Set the ETA receiver / ZATCA buyer profile of a customer' })
  @RequirePermissions({ module: 'compliance', screen: 'settings', action: 'update' })
  @Put('parties/:customerId')
  upsertParty(
    @CurrentTenant() tenantId: string,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: UpsertCompliancePartyDto,
  ) {
    return this.settingsService.upsertParty(tenantId, customerId, dto);
  }
}
