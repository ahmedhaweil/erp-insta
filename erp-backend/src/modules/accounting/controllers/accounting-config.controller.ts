import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Budget } from '../entities/budget.entity';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { AccountingSettingsService } from '../services/accounting-settings.service';
import { FiscalYearsService } from '../services/fiscal-years.service';
import { FixedAssetsService } from '../services/fixed-assets.service';
import { UpdateAccountingSettingsDto } from '../dto/update-accounting-settings.dto';
import { AccountingSetupService } from '../services/accounting-setup.service';
import { AccountingSetupDto } from '../dto/accounting-setup.dto';
import {
  CreateBudgetDto,
  CreateFiscalYearDto,
  CreateFixedAssetDto,
  DisposeAssetDto,
  RunDepreciationDto,
} from '../dto/fixed-asset.dto';

@ApiTags('accounting')
@ApiBearerAuth()
@Controller('accounting')
export class AccountingConfigController {
  constructor(
    private readonly settingsService: AccountingSettingsService,
    private readonly fiscalYearsService: FiscalYearsService,
    private readonly fixedAssetsService: FixedAssetsService,
    private readonly setupService: AccountingSetupService,
    @InjectRepository(Budget)
    private readonly budgetRepo: Repository<Budget>,
  ) {}

  @RequirePermissions({ module: 'accounting', screen: 'setup', action: 'read' })
  @Get('setup/templates')
  listChartTemplates() {
    return this.setupService.listTemplates();
  }

  @RequirePermissions({ module: 'accounting', screen: 'setup', action: 'read' })
  @Get('setup/templates/:code')
  previewChartTemplate(@Param('code') code: string) {
    return this.setupService.previewTemplate(code as 'eg' | 'sa');
  }

  /**
   * Setup wizard: creates the chart of accounts from a country template, fills
   * every default account, opens the fiscal year and creates journals and
   * currencies. Refused when the tenant already has accounts.
   */
  @RequirePermissions({ module: 'accounting', screen: 'setup', action: 'create' })
  @Post('setup')
  setupAccounting(@CurrentTenant() tenantId: string, @Body() dto: AccountingSetupDto) {
    return this.setupService.setup(tenantId, dto);
  }

  @RequirePermissions({ module: 'accounting', screen: 'budgets', action: 'read' })
  @Get('budgets')
  findBudgets(@CurrentTenant() tenantId: string) {
    return this.budgetRepo.find({ where: { tenantId } });
  }

  @RequirePermissions({ module: 'accounting', screen: 'budgets', action: 'create' })
  @Post('budgets')
  createBudget(@CurrentTenant() tenantId: string, @Body() dto: CreateBudgetDto) {
    return this.budgetRepo.save(this.budgetRepo.create({ ...dto, tenantId }));
  }

  @RequirePermissions({ module: 'accounting', screen: 'settings', action: 'read' })
  @Get('settings')
  getSettings(@CurrentTenant() tenantId: string) {
    return this.settingsService.find(tenantId);
  }

  @RequirePermissions({ module: 'accounting', screen: 'settings', action: 'update' })
  @Put('settings')
  updateSettings(@CurrentTenant() tenantId: string, @Body() dto: UpdateAccountingSettingsDto) {
    return this.settingsService.upsert(tenantId, dto);
  }

  @RequirePermissions({ module: 'accounting', screen: 'fiscal-years', action: 'read' })
  @Get('fiscal-years')
  findFiscalYears(@CurrentTenant() tenantId: string) {
    return this.fiscalYearsService.findAll(tenantId);
  }

  @RequirePermissions({ module: 'accounting', screen: 'fiscal-years', action: 'create' })
  @Post('fiscal-years')
  createFiscalYear(@CurrentTenant() tenantId: string, @Body() dto: CreateFiscalYearDto) {
    return this.fiscalYearsService.create(tenantId, dto);
  }

  @RequirePermissions({ module: 'accounting', screen: 'fiscal-years', action: 'update' })
  @Post('fiscal-years/:id/close')
  closeFiscalYear(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.fiscalYearsService.close(tenantId, user.sub, id);
  }

  @RequirePermissions({ module: 'accounting', screen: 'fixed-assets', action: 'read' })
  @Get('fixed-assets')
  findAssets(@CurrentTenant() tenantId: string) {
    return this.fixedAssetsService.findAll(tenantId);
  }

  @RequirePermissions({ module: 'accounting', screen: 'fixed-assets', action: 'create' })
  @Post('fixed-assets')
  createAsset(@CurrentTenant() tenantId: string, @Body() dto: CreateFixedAssetDto) {
    return this.fixedAssetsService.create(tenantId, dto);
  }

  @RequirePermissions({ module: 'accounting', screen: 'fixed-assets', action: 'post' })
  @Post('fixed-assets/depreciate')
  runDepreciation(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: RunDepreciationDto,
  ) {
    return this.fixedAssetsService.runDepreciation(tenantId, user.sub, dto.asOf);
  }

  @RequirePermissions({ module: 'accounting', screen: 'fixed-assets', action: 'read' })
  @Get('fixed-assets/:id/schedule')
  getSchedule(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.fixedAssetsService.getSchedule(tenantId, id);
  }

  @RequirePermissions({ module: 'accounting', screen: 'fixed-assets', action: 'update' })
  @Post('fixed-assets/:id/dispose')
  dispose(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: DisposeAssetDto,
  ) {
    return this.fixedAssetsService.dispose(tenantId, user.sub, id, dto);
  }
}
