import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { PromotionsService } from '../services/promotions.service';
import { PromotionDocumentType } from '../entities/promotion-usage.entity';
import {
  CreateBonusRuleDto,
  CreateCampaignDto,
  CreateInvoiceDiscountDto,
  EvaluatePromotionsDto,
  PriceCheckQueryDto,
  PromotionListQueryDto,
  PromotionReportQueryDto,
  UpdateBonusRuleDto,
  UpdateCampaignDto,
  UpdateInvoiceDiscountDto,
  UpdatePromotionSettingsDto,
} from '../dto/promotion.dto';

const M = 'promotions';

@ApiTags('promotions')
@ApiBearerAuth()
@Controller('promotions')
export class PromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  // ------------------------------------------------------------ evaluate / tools

  @RequirePermissions({ module: M, screen: 'evaluate', action: 'read' })
  @Post('evaluate')
  @ApiOperation({ summary: 'Preview the promotions a basket would get (nothing is saved)' })
  evaluate(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: EvaluatePromotionsDto,
  ) {
    return this.promotions.evaluate(tenantId, user.sub, dto);
  }

  @RequirePermissions({ module: M, screen: 'evaluate', action: 'read' })
  @Get('price-check')
  @ApiOperation({ summary: 'List price, campaign price and up to 5 cheaper alternatives' })
  priceCheck(@CurrentTenant() tenantId: string, @Query() query: PriceCheckQueryDto) {
    return this.promotions.priceCheck(tenantId, query);
  }

  @RequirePermissions({ module: M, screen: 'reports', action: 'read' })
  @Get('reports/cost')
  @ApiOperation({ summary: 'Promotion cost per rule for a period' })
  costReport(@CurrentTenant() tenantId: string, @Query() query: PromotionReportQueryDto) {
    return this.promotions.costReport(tenantId, query.from, query.to);
  }

  @RequirePermissions({ module: M, screen: 'reports', action: 'read' })
  @Get('usages')
  @ApiQuery({ name: 'documentType', required: false })
  @ApiQuery({ name: 'documentId', required: false })
  usages(
    @CurrentTenant() tenantId: string,
    @Query('documentType') documentType?: PromotionDocumentType,
    @Query('documentId') documentId?: string,
  ) {
    return this.promotions.findUsages(tenantId, documentType, documentId);
  }

  @RequirePermissions({ module: M, screen: 'settings', action: 'read' })
  @Get('settings')
  getSettings(@CurrentTenant() tenantId: string) {
    return this.promotions.getSettings(tenantId);
  }

  @RequirePermissions({ module: M, screen: 'settings', action: 'update' })
  @Put('settings')
  updateSettings(@CurrentTenant() tenantId: string, @Body() dto: UpdatePromotionSettingsDto) {
    return this.promotions.updateSettings(tenantId, dto);
  }

  // ------------------------------------------------------------ campaigns

  @RequirePermissions({ module: M, screen: 'campaigns', action: 'read' })
  @Get('campaigns')
  findCampaigns(@CurrentTenant() tenantId: string, @Query() q: PromotionListQueryDto) {
    return this.promotions.findCampaigns(tenantId, q.activeOnly === 'true');
  }

  @RequirePermissions({ module: M, screen: 'campaigns', action: 'read' })
  @Get('campaigns/:id')
  getCampaign(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.promotions.getCampaign(tenantId, id);
  }

  @RequirePermissions({ module: M, screen: 'campaigns', action: 'create' })
  @Post('campaigns')
  createCampaign(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateCampaignDto,
  ) {
    return this.promotions.createCampaign(tenantId, user.sub, dto);
  }

  @RequirePermissions({ module: M, screen: 'campaigns', action: 'update' })
  @Patch('campaigns/:id')
  updateCampaign(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCampaignDto,
  ) {
    return this.promotions.updateCampaign(tenantId, id, dto);
  }

  @RequirePermissions({ module: M, screen: 'campaigns', action: 'update' })
  @Post('campaigns/:id/activate')
  activateCampaign(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.promotions.setActive(tenantId, 'campaign', id, true);
  }

  @RequirePermissions({ module: M, screen: 'campaigns', action: 'update' })
  @Post('campaigns/:id/deactivate')
  deactivateCampaign(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.promotions.setActive(tenantId, 'campaign', id, false);
  }

  @RequirePermissions({ module: M, screen: 'campaigns', action: 'delete' })
  @Delete('campaigns/:id')
  removeCampaign(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.promotions.remove(tenantId, 'campaign', id);
  }

  // ------------------------------------------------------------ bonus rules

  @RequirePermissions({ module: M, screen: 'bonuses', action: 'read' })
  @Get('bonus-rules')
  findBonusRules(@CurrentTenant() tenantId: string, @Query() q: PromotionListQueryDto) {
    return this.promotions.findBonusRules(tenantId, q.activeOnly === 'true');
  }

  @RequirePermissions({ module: M, screen: 'bonuses', action: 'read' })
  @Get('bonus-rules/:id')
  getBonusRule(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.promotions.getBonusRule(tenantId, id);
  }

  @RequirePermissions({ module: M, screen: 'bonuses', action: 'create' })
  @Post('bonus-rules')
  createBonusRule(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateBonusRuleDto,
  ) {
    return this.promotions.createBonusRule(tenantId, user.sub, dto);
  }

  @RequirePermissions({ module: M, screen: 'bonuses', action: 'update' })
  @Patch('bonus-rules/:id')
  updateBonusRule(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateBonusRuleDto,
  ) {
    return this.promotions.updateBonusRule(tenantId, id, dto);
  }

  @RequirePermissions({ module: M, screen: 'bonuses', action: 'update' })
  @Post('bonus-rules/:id/activate')
  activateBonusRule(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.promotions.setActive(tenantId, 'bonus', id, true);
  }

  @RequirePermissions({ module: M, screen: 'bonuses', action: 'update' })
  @Post('bonus-rules/:id/deactivate')
  deactivateBonusRule(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.promotions.setActive(tenantId, 'bonus', id, false);
  }

  @RequirePermissions({ module: M, screen: 'bonuses', action: 'delete' })
  @Delete('bonus-rules/:id')
  removeBonusRule(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.promotions.remove(tenantId, 'bonus', id);
  }

  // ------------------------------------------------------------ invoice discounts

  @RequirePermissions({ module: M, screen: 'invoice_discounts', action: 'read' })
  @Get('invoice-discounts')
  findInvoiceDiscounts(@CurrentTenant() tenantId: string, @Query() q: PromotionListQueryDto) {
    return this.promotions.findInvoiceDiscounts(tenantId, q.activeOnly === 'true');
  }

  @RequirePermissions({ module: M, screen: 'invoice_discounts', action: 'read' })
  @Get('invoice-discounts/:id')
  getInvoiceDiscount(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.promotions.getInvoiceDiscount(tenantId, id);
  }

  @RequirePermissions({ module: M, screen: 'invoice_discounts', action: 'create' })
  @Post('invoice-discounts')
  createInvoiceDiscount(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateInvoiceDiscountDto,
  ) {
    return this.promotions.createInvoiceDiscount(tenantId, user.sub, dto);
  }

  @RequirePermissions({ module: M, screen: 'invoice_discounts', action: 'update' })
  @Patch('invoice-discounts/:id')
  updateInvoiceDiscount(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateInvoiceDiscountDto,
  ) {
    return this.promotions.updateInvoiceDiscount(tenantId, id, dto);
  }

  @RequirePermissions({ module: M, screen: 'invoice_discounts', action: 'update' })
  @Post('invoice-discounts/:id/activate')
  activateInvoiceDiscount(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.promotions.setActive(tenantId, 'invoice_discount', id, true);
  }

  @RequirePermissions({ module: M, screen: 'invoice_discounts', action: 'update' })
  @Post('invoice-discounts/:id/deactivate')
  deactivateInvoiceDiscount(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.promotions.setActive(tenantId, 'invoice_discount', id, false);
  }

  @RequirePermissions({ module: M, screen: 'invoice_discounts', action: 'delete' })
  @Delete('invoice-discounts/:id')
  removeInvoiceDiscount(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.promotions.remove(tenantId, 'invoice_discount', id);
  }
}
