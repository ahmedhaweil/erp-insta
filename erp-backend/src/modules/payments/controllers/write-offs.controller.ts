import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { WriteOffsService } from '../services/write-offs.service';
import { CreateWriteOffDto, WriteOffQueryDto } from '../dto/write-off.dto';
import { PaymentPartnerType } from '../entities/payment.entity';

const CUSTOMER = PaymentPartnerType.CUSTOMER;
const SUPPLIER = PaymentPartnerType.SUPPLIER;

/** Customer balance write-offs (bad debt / discount allowed). */
@ApiTags('sales')
@ApiBearerAuth()
@Controller('sales/writeoffs')
export class SalesWriteOffsController {
  constructor(private readonly writeOffs: WriteOffsService) {}

  @RequirePermissions({ module: 'sales', screen: 'writeoffs', action: 'create' })
  @Post()
  @ApiOperation({ summary: 'Write off the residual of open customer invoices (WO-)' })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateWriteOffDto,
  ) {
    return this.writeOffs.create(tenantId, user.sub, CUSTOMER, dto);
  }

  @RequirePermissions({ module: 'sales', screen: 'writeoffs', action: 'read' })
  @Get()
  findAll(@CurrentTenant() tenantId: string, @Query() query: WriteOffQueryDto) {
    return this.writeOffs.findAll(tenantId, CUSTOMER, query);
  }

  @RequirePermissions({ module: 'sales', screen: 'writeoffs', action: 'read' })
  @Get(':id')
  findById(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.writeOffs.findById(tenantId, CUSTOMER, id);
  }

  @RequirePermissions({ module: 'sales', screen: 'writeoffs', action: 'update' })
  @Post(':id/post')
  post(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.writeOffs.post(tenantId, user.sub, CUSTOMER, id);
  }

  @RequirePermissions({ module: 'sales', screen: 'writeoffs', action: 'update' })
  @Post(':id/cancel')
  cancel(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.writeOffs.cancel(tenantId, user.sub, CUSTOMER, id);
  }
}

/** Supplier balance write-offs (write-off income / discount received). */
@ApiTags('purchasing')
@ApiBearerAuth()
@Controller('purchasing/writeoffs')
export class PurchaseWriteOffsController {
  constructor(private readonly writeOffs: WriteOffsService) {}

  @RequirePermissions({ module: 'purchasing', screen: 'writeoffs', action: 'create' })
  @Post()
  @ApiOperation({ summary: 'Write off the residual of open vendor bills (WO-)' })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateWriteOffDto,
  ) {
    return this.writeOffs.create(tenantId, user.sub, SUPPLIER, dto);
  }

  @RequirePermissions({ module: 'purchasing', screen: 'writeoffs', action: 'read' })
  @Get()
  findAll(@CurrentTenant() tenantId: string, @Query() query: WriteOffQueryDto) {
    return this.writeOffs.findAll(tenantId, SUPPLIER, query);
  }

  @RequirePermissions({ module: 'purchasing', screen: 'writeoffs', action: 'read' })
  @Get(':id')
  findById(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.writeOffs.findById(tenantId, SUPPLIER, id);
  }

  @RequirePermissions({ module: 'purchasing', screen: 'writeoffs', action: 'update' })
  @Post(':id/post')
  post(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.writeOffs.post(tenantId, user.sub, SUPPLIER, id);
  }

  @RequirePermissions({ module: 'purchasing', screen: 'writeoffs', action: 'update' })
  @Post(':id/cancel')
  cancel(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.writeOffs.cancel(tenantId, user.sub, SUPPLIER, id);
  }
}
