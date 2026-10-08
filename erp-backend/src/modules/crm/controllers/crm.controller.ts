import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { CrmStagesService } from '../services/crm-stages.service';
import { CrmLeadsService } from '../services/crm-leads.service';
import { CrmActivitiesService } from '../services/crm-activities.service';
import { CrmReportsService } from '../services/crm-reports.service';
import {
  ActivityQueryDto,
  CompleteActivityDto,
  ConvertToCustomerDto,
  CreateActivityDto,
  CreateLeadDto,
  CreateQuotationDto,
  CreateStageDto,
  LeadQueryDto,
  MarkLostDto,
  MoveStageDto,
  MyActivitiesQueryDto,
  PipelineReportQueryDto,
  UpdateActivityDto,
  UpdateLeadDto,
  UpdateStageDto,
} from '../dto/crm.dto';

const leads = (action: string) => ({ module: 'crm', screen: 'leads', action });
const activities = (action: string) => ({ module: 'crm', screen: 'activities', action });

@ApiTags('crm')
@ApiBearerAuth()
@Controller('crm/stages')
export class CrmStagesController {
  constructor(private readonly service: CrmStagesService) {}

  @RequirePermissions(leads('read'))
  @Get()
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  findAll(@CurrentTenant() tenantId: string, @Query('includeInactive') includeInactive?: string) {
    return this.service.findAll(tenantId, includeInactive === 'true');
  }

  @RequirePermissions(leads('create'))
  @Post()
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateStageDto) {
    return this.service.create(tenantId, dto);
  }

  @RequirePermissions(leads('update'))
  @Patch(':id')
  update(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: UpdateStageDto) {
    return this.service.update(tenantId, id, dto);
  }

  @RequirePermissions(leads('delete'))
  @Delete(':id')
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.remove(tenantId, id);
  }
}

@ApiTags('crm')
@ApiBearerAuth()
@Controller('crm/leads')
export class CrmLeadsController {
  constructor(private readonly service: CrmLeadsService) {}

  @RequirePermissions(leads('create'))
  @Post()
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateLeadDto,
  ) {
    return this.service.create(tenantId, user.sub, dto);
  }

  @RequirePermissions(leads('read'))
  @Get()
  findAll(@CurrentTenant() tenantId: string, @Query() query: LeadQueryDto) {
    return this.service.findAll(tenantId, query);
  }

  @RequirePermissions(leads('read'))
  @Get(':id')
  findById(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.findById(tenantId, id);
  }

  @RequirePermissions(leads('update'))
  @Patch(':id')
  update(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: UpdateLeadDto) {
    return this.service.update(tenantId, id, dto);
  }

  @RequirePermissions(leads('delete'))
  @Delete(':id')
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.remove(tenantId, id);
  }

  @RequirePermissions(leads('update'))
  @Post(':id/stage')
  moveStage(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: MoveStageDto) {
    return this.service.moveStage(tenantId, id, dto.stageId);
  }

  @RequirePermissions(leads('update'))
  @Post(':id/won')
  won(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.markWon(tenantId, id);
  }

  @RequirePermissions(leads('update'))
  @Post(':id/lost')
  lost(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: MarkLostDto) {
    return this.service.markLost(tenantId, id, dto.reason);
  }

  @RequirePermissions(leads('update'))
  @Post(':id/reopen')
  reopen(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.reopen(tenantId, id);
  }

  @RequirePermissions(leads('update'))
  @Post(':id/convert-to-opportunity')
  toOpportunity(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.convertToOpportunity(tenantId, id);
  }

  @RequirePermissions(leads('update'), { module: 'sales', screen: 'customers', action: 'create' })
  @Post(':id/convert-to-customer')
  @ApiOperation({ summary: 'Create (or link) the customer for this lead' })
  toCustomer(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: ConvertToCustomerDto,
  ) {
    return this.service.convertToCustomer(tenantId, id, dto);
  }

  @RequirePermissions(leads('update'), { module: 'sales', screen: 'orders', action: 'create' })
  @Post(':id/quotation')
  @ApiOperation({ summary: 'Create a draft quotation (sales order) for this opportunity' })
  quotation(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CreateQuotationDto,
  ) {
    return this.service.createQuotation(tenantId, user.sub, id, dto);
  }
}

@ApiTags('crm')
@ApiBearerAuth()
@Controller('crm/activities')
export class CrmActivitiesController {
  constructor(private readonly service: CrmActivitiesService) {}

  @RequirePermissions(activities('create'))
  @Post()
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateActivityDto,
  ) {
    return this.service.create(tenantId, user.sub, dto);
  }

  @RequirePermissions(activities('read'))
  @Get()
  findAll(@CurrentTenant() tenantId: string, @Query() query: ActivityQueryDto) {
    return this.service.findAll(tenantId, query);
  }

  @RequirePermissions(activities('read'))
  @Get('my')
  @ApiOperation({ summary: "Current user's activities (default: all planned incl. overdue)" })
  my(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Query() query: MyActivitiesQueryDto,
  ) {
    return this.service.my(tenantId, user.sub, query.state);
  }

  @RequirePermissions(activities('read'))
  @Get(':id')
  findById(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.findById(tenantId, id);
  }

  @RequirePermissions(activities('update'))
  @Patch(':id')
  update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateActivityDto,
  ) {
    return this.service.update(tenantId, id, dto);
  }

  @RequirePermissions(activities('update'))
  @Post(':id/done')
  done(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: CompleteActivityDto,
  ) {
    return this.service.markDone(tenantId, id, dto.result);
  }

  @RequirePermissions(activities('update'))
  @Post(':id/cancel')
  cancel(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.cancel(tenantId, id);
  }

  @RequirePermissions(activities('delete'))
  @Delete(':id')
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.remove(tenantId, id);
  }
}

@ApiTags('crm')
@ApiBearerAuth()
@Controller('crm/reports')
export class CrmReportsController {
  constructor(private readonly service: CrmReportsService) {}

  @RequirePermissions(leads('read'))
  @Get('pipeline')
  @ApiOperation({ summary: 'Pipeline: count and weighted value per stage, win rate, by salesperson' })
  pipeline(@CurrentTenant() tenantId: string, @Query() query: PipelineReportQueryDto) {
    return this.service.pipeline(tenantId, query);
  }
}
