import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PriceListsService } from '../services/price-lists.service';
import { SalesPricingService } from '../services/sales-pricing.service';
import {
  CreateCustomerCategoryDto,
  CreatePriceListDto,
  MinSellPriceDto,
  PriceListRuleDto,
  PriceQueryDto,
  UpdateCustomerCategoryDto,
  UpdatePriceListDto,
} from '../dto/price-list.dto';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';

@ApiTags('sales')
@ApiBearerAuth()
@Controller('sales/price-lists')
export class PriceListsController {
  constructor(private readonly priceLists: PriceListsService) {}

  @RequirePermissions({ module: 'sales', screen: 'price_lists', action: 'create' })
  @Post()
  create(@CurrentTenant() tenantId: string, @Body() dto: CreatePriceListDto) {
    return this.priceLists.create(tenantId, dto);
  }

  @RequirePermissions({ module: 'sales', screen: 'price_lists', action: 'read' })
  @Get()
  findAll(@CurrentTenant() tenantId: string) {
    return this.priceLists.findAll(tenantId);
  }

  @RequirePermissions({ module: 'sales', screen: 'price_lists', action: 'read' })
  @Get(':id')
  findById(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.priceLists.findById(tenantId, id);
  }

  @RequirePermissions({ module: 'sales', screen: 'price_lists', action: 'update' })
  @Patch(':id')
  @ApiOperation({ summary: 'Update a price list; `rules`, when given, replace all rules' })
  update(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: UpdatePriceListDto) {
    return this.priceLists.update(tenantId, id, dto);
  }

  @RequirePermissions({ module: 'sales', screen: 'price_lists', action: 'update' })
  @Post(':id/rules')
  addRule(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: PriceListRuleDto) {
    return this.priceLists.addRule(tenantId, id, dto);
  }

  @RequirePermissions({ module: 'sales', screen: 'price_lists', action: 'update' })
  @Delete(':id/rules/:ruleId')
  removeRule(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Param('ruleId') ruleId: string,
  ) {
    return this.priceLists.removeRule(tenantId, id, ruleId);
  }
}

@ApiTags('sales')
@ApiBearerAuth()
@Controller('sales/pricing')
export class PricingController {
  constructor(private readonly pricing: SalesPricingService) {}

  @RequirePermissions({ module: 'sales', screen: 'price_lists', action: 'read' })
  @Get('price')
  @ApiOperation({ summary: 'Price of a product for a customer, quantity and date' })
  price(@CurrentTenant() tenantId: string, @Query() query: PriceQueryDto) {
    return this.pricing.computePrice(tenantId, query);
  }

  @RequirePermissions({ module: 'sales', screen: 'price_lists', action: 'update' })
  @Patch('products/:productId/min-price')
  @ApiOperation({ summary: 'Set the minimum selling price of a product' })
  setMinPrice(
    @CurrentTenant() tenantId: string,
    @Param('productId') productId: string,
    @Body() dto: MinSellPriceDto,
  ) {
    return this.pricing.setMinSellPrice(tenantId, productId, dto.minSellPrice ?? null);
  }
}

@ApiTags('sales')
@ApiBearerAuth()
@Controller('sales/customer-categories')
export class CustomerCategoriesController {
  constructor(private readonly priceLists: PriceListsService) {}

  @RequirePermissions({ module: 'sales', screen: 'customers', action: 'create' })
  @Post()
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateCustomerCategoryDto) {
    return this.priceLists.createCategory(tenantId, dto);
  }

  @RequirePermissions({ module: 'sales', screen: 'customers', action: 'read' })
  @Get()
  findAll(@CurrentTenant() tenantId: string) {
    return this.priceLists.findCategories(tenantId);
  }

  @RequirePermissions({ module: 'sales', screen: 'customers', action: 'update' })
  @Patch(':id')
  update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCustomerCategoryDto,
  ) {
    return this.priceLists.updateCategory(tenantId, id, dto);
  }
}
