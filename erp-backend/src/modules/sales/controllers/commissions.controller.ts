import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CommissionsService } from '../services/commissions.service';
import {
  CommissionPeriodDto,
  CreateCommissionRuleDto,
  CreateSalesRepDto,
  PostCommissionDto,
  UpdateCommissionRuleDto,
  UpdateSalesRepDto,
} from '../dto/sales-rep.dto';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';

@ApiTags('sales')
@ApiBearerAuth()
@Controller('sales/reps')
export class SalesRepsController {
  constructor(private readonly commissions: CommissionsService) {}

  @RequirePermissions({ module: 'sales', screen: 'reps', action: 'create' })
  @Post()
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateSalesRepDto) {
    return this.commissions.createRep(tenantId, dto);
  }

  @RequirePermissions({ module: 'sales', screen: 'reps', action: 'read' })
  @Get()
  findAll(@CurrentTenant() tenantId: string) {
    return this.commissions.findReps(tenantId);
  }

  @RequirePermissions({ module: 'sales', screen: 'reps', action: 'read' })
  @Get(':id')
  findById(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.commissions.findRep(tenantId, id);
  }

  @RequirePermissions({ module: 'sales', screen: 'reps', action: 'update' })
  @Patch(':id')
  update(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: UpdateSalesRepDto) {
    return this.commissions.updateRep(tenantId, id, dto);
  }
}

@ApiTags('sales')
@ApiBearerAuth()
@Controller('sales/commission-rules')
export class CommissionRulesController {
  constructor(private readonly commissions: CommissionsService) {}

  @RequirePermissions({ module: 'sales', screen: 'commissions', action: 'create' })
  @Post()
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateCommissionRuleDto) {
    return this.commissions.createRule(tenantId, dto);
  }

  @RequirePermissions({ module: 'sales', screen: 'commissions', action: 'read' })
  @Get()
  @ApiQuery({ name: 'salesRepId', required: false })
  findAll(@CurrentTenant() tenantId: string, @Query('salesRepId') salesRepId?: string) {
    return this.commissions.findRules(tenantId, salesRepId);
  }

  @RequirePermissions({ module: 'sales', screen: 'commissions', action: 'update' })
  @Patch(':id')
  update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCommissionRuleDto,
  ) {
    return this.commissions.updateRule(tenantId, id, dto);
  }
}

@ApiTags('sales')
@ApiBearerAuth()
@Controller('sales/commission-statements')
export class CommissionStatementsController {
  constructor(private readonly commissions: CommissionsService) {}

  @RequirePermissions({ module: 'sales', screen: 'commissions', action: 'read' })
  @Get('rep-performance')
  @ApiOperation({ summary: 'Commission vs sales per sales representative for a period' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'salesRepId', required: false })
  repPerformance(
    @CurrentTenant() tenantId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('salesRepId') salesRepId?: string,
  ) {
    return this.commissions.repPerformance(tenantId, { from, to, salesRepId });
  }

  @RequirePermissions({ module: 'sales', screen: 'commissions', action: 'read' })
  @Get('preview')
  @ApiOperation({ summary: 'Compute the commission of a rep for a period without saving' })
  preview(@CurrentTenant() tenantId: string, @Query() query: CommissionPeriodDto) {
    return this.commissions.compute(tenantId, query);
  }

  @RequirePermissions({ module: 'sales', screen: 'commissions', action: 'create' })
  @Post()
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CommissionPeriodDto,
  ) {
    return this.commissions.createStatement(tenantId, user.sub, dto);
  }

  @RequirePermissions({ module: 'sales', screen: 'commissions', action: 'read' })
  @Get()
  @ApiQuery({ name: 'salesRepId', required: false })
  findAll(@CurrentTenant() tenantId: string, @Query('salesRepId') salesRepId?: string) {
    return this.commissions.findStatements(tenantId, salesRepId);
  }

  @RequirePermissions({ module: 'sales', screen: 'commissions', action: 'read' })
  @Get(':id')
  findById(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.commissions.findStatement(tenantId, id);
  }

  @RequirePermissions({ module: 'sales', screen: 'commissions', action: 'update' })
  @Post(':id/post')
  @ApiOperation({ summary: 'Accrue the commission (Dr commission expense / Cr commission payable)' })
  post(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: PostCommissionDto,
  ) {
    return this.commissions.postStatement(tenantId, user.sub, id, dto);
  }

  @RequirePermissions({ module: 'sales', screen: 'commissions', action: 'update' })
  @Post(':id/cancel')
  cancel(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.commissions.cancelStatement(tenantId, user.sub, id);
  }
}
