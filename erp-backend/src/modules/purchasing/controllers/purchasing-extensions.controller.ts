import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PurchasingSettingsService } from '../services/purchasing-settings.service';
import { PurchaseRequisitionsService } from '../services/purchase-requisitions.service';
import { PurchaseReturnsService } from '../services/purchase-returns.service';
import { RejectDto, UpdatePurchasingSettingsDto } from '../dto/purchasing-settings.dto';
import {
  ConvertRequisitionDto,
  CreatePurchaseRequisitionDto,
} from '../dto/purchase-requisition.dto';
import { CreatePurchaseReturnDto } from '../dto/purchase-return.dto';
import { PurchaseRequisitionStatus } from '../entities/purchase-requisition.entity';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';

@ApiTags('purchasing')
@ApiBearerAuth()
@Controller('purchasing/settings')
export class PurchasingSettingsController {
  constructor(private readonly settings: PurchasingSettingsService) {}

  @RequirePermissions({ module: 'purchasing', screen: 'settings', action: 'read' })
  @Get()
  get(@CurrentTenant() tenantId: string) {
    return this.settings.get(tenantId);
  }

  @RequirePermissions({ module: 'purchasing', screen: 'settings', action: 'update' })
  @Put()
  @ApiOperation({ summary: 'Set the PO approval threshold and requisition policy' })
  update(@CurrentTenant() tenantId: string, @Body() dto: UpdatePurchasingSettingsDto) {
    return this.settings.update(tenantId, dto);
  }
}

@ApiTags('purchasing')
@ApiBearerAuth()
@Controller('purchasing/requisitions')
export class PurchaseRequisitionsController {
  constructor(private readonly requisitions: PurchaseRequisitionsService) {}

  @RequirePermissions({ module: 'purchasing', screen: 'requisitions', action: 'create' })
  @Post()
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePurchaseRequisitionDto,
  ) {
    return this.requisitions.create(tenantId, user.sub, dto);
  }

  @RequirePermissions({ module: 'purchasing', screen: 'requisitions', action: 'read' })
  @Get()
  @ApiQuery({ name: 'status', required: false, enum: PurchaseRequisitionStatus })
  findAll(@CurrentTenant() tenantId: string, @Query('status') status?: PurchaseRequisitionStatus) {
    return this.requisitions.findAll(tenantId, status);
  }

  @RequirePermissions({ module: 'purchasing', screen: 'requisitions', action: 'read' })
  @Get(':id')
  findById(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.requisitions.findById(tenantId, id);
  }

  @RequirePermissions({ module: 'purchasing', screen: 'requisitions', action: 'update' })
  @Post(':id/submit')
  submit(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.requisitions.submit(tenantId, id);
  }

  @RequirePermissions({ module: 'purchasing', screen: 'requisitions', action: 'approve' })
  @Post(':id/approve')
  approve(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.requisitions.approve(tenantId, user.sub, id);
  }

  @RequirePermissions({ module: 'purchasing', screen: 'requisitions', action: 'approve' })
  @Post(':id/reject')
  reject(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: RejectDto) {
    return this.requisitions.reject(tenantId, id, dto.reason);
  }

  @RequirePermissions({ module: 'purchasing', screen: 'requisitions', action: 'update' })
  @Post(':id/cancel')
  cancel(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.requisitions.cancel(tenantId, id);
  }

  @RequirePermissions({ module: 'purchasing', screen: 'orders', action: 'create' })
  @Post(':id/convert')
  @ApiOperation({ summary: 'Convert the requisition into draft RFQs (one per vendor)' })
  convert(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ConvertRequisitionDto,
  ) {
    return this.requisitions.convert(tenantId, user.sub, id, dto);
  }
}

@ApiTags('purchasing')
@ApiBearerAuth()
@Controller('purchasing/returns')
export class PurchaseReturnsController {
  constructor(private readonly returns: PurchaseReturnsService) {}

  @RequirePermissions({ module: 'purchasing', screen: 'returns', action: 'create' })
  @Post()
  @ApiOperation({ summary: 'Create a purchase return against an approved bill, or with explicit prices' })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePurchaseReturnDto,
  ) {
    return this.returns.create(tenantId, user.sub, dto);
  }

  @RequirePermissions({ module: 'purchasing', screen: 'returns', action: 'read' })
  @Get()
  @ApiQuery({ name: 'supplierId', required: false })
  @ApiQuery({ name: 'billId', required: false })
  findAll(
    @CurrentTenant() tenantId: string,
    @Query('supplierId') supplierId?: string,
    @Query('billId') billId?: string,
  ) {
    return this.returns.findAll(tenantId, { supplierId, billId });
  }

  @RequirePermissions({ module: 'purchasing', screen: 'returns', action: 'read' })
  @Get(':id')
  findById(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.returns.findById(tenantId, id);
  }

  @RequirePermissions({ module: 'purchasing', screen: 'returns', action: 'update' })
  @Post(':id/post')
  @ApiOperation({ summary: 'Take the goods out of stock and issue (and approve) the vendor refund' })
  post(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.returns.post(tenantId, user.sub, id);
  }

  @RequirePermissions({ module: 'purchasing', screen: 'returns', action: 'update' })
  @ApiOperation({
    summary:
      'Cancel a draft return, or a posted one: stock, credit note / refund and cash refund are reversed when not otherwise settled',
  })
  @Post(':id/cancel')
  cancel(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.returns.cancel(tenantId, id, user.sub);
  }
}
