import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { TransfersService } from '../services/transfers.service';
import { CancelDto, CreateTransferDto, DateRangeQueryDto } from '../dto/treasury.dto';

@ApiTags('treasury')
@ApiBearerAuth()
@Controller('treasury/transfers')
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @RequirePermissions({ module: 'treasury', screen: 'transfers', action: 'read' })
  @Get()
  @ApiQuery({ name: 'treasuryId', required: false })
  findAll(
    @CurrentTenant() tenantId: string,
    @Query() query: DateRangeQueryDto,
    @Query('treasuryId') treasuryId?: string,
  ) {
    return this.transfers.findAll(tenantId, { ...query, treasuryId });
  }

  @RequirePermissions({ module: 'treasury', screen: 'transfers', action: 'create' })
  @Post()
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateTransferDto,
  ) {
    return this.transfers.create(tenantId, user.sub, dto);
  }

  @RequirePermissions({ module: 'treasury', screen: 'transfers', action: 'read' })
  @Get(':id')
  findById(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.transfers.findById(tenantId, id);
  }

  @RequirePermissions({ module: 'treasury', screen: 'transfers', action: 'post' })
  @Post(':id/post')
  post(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.transfers.post(tenantId, user.sub, id);
  }

  @RequirePermissions({ module: 'treasury', screen: 'transfers', action: 'cancel' })
  @Post(':id/cancel')
  cancel(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CancelDto,
  ) {
    return this.transfers.cancel(tenantId, user.sub, id, dto);
  }
}
