import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { VouchersService } from '../services/vouchers.service';
import {
  CancelDto,
  CreateVoucherDto,
  UpdateVoucherDto,
  VoucherQueryDto,
} from '../dto/treasury.dto';

@ApiTags('treasury')
@ApiBearerAuth()
@Controller('treasury/vouchers')
export class VouchersController {
  constructor(private readonly vouchers: VouchersService) {}

  @RequirePermissions({ module: 'treasury', screen: 'vouchers', action: 'read' })
  @Get()
  findAll(@CurrentTenant() tenantId: string, @Query() query: VoucherQueryDto) {
    return this.vouchers.findAll(tenantId, query);
  }

  @RequirePermissions({ module: 'treasury', screen: 'vouchers', action: 'create' })
  @Post()
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateVoucherDto,
  ) {
    return this.vouchers.create(tenantId, user.sub, dto);
  }

  @RequirePermissions({ module: 'treasury', screen: 'vouchers', action: 'read' })
  @Get(':id')
  findById(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.vouchers.findById(tenantId, id);
  }

  @RequirePermissions({ module: 'treasury', screen: 'vouchers', action: 'update' })
  @Patch(':id')
  update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateVoucherDto,
  ) {
    return this.vouchers.update(tenantId, id, dto);
  }

  @RequirePermissions({ module: 'treasury', screen: 'vouchers', action: 'post' })
  @Post(':id/post')
  post(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.vouchers.post(tenantId, user.sub, id);
  }

  @RequirePermissions({ module: 'treasury', screen: 'vouchers', action: 'cancel' })
  @Post(':id/cancel')
  cancel(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CancelDto,
  ) {
    return this.vouchers.cancel(tenantId, user.sub, id, dto);
  }
}
