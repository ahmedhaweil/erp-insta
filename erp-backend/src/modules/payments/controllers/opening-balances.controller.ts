import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { OpeningBalancesService } from '../services/opening-balances.service';
import { CreateOpeningBalanceDto } from '../dto/opening-balance.dto';
import { OpeningBalanceStatus } from '../entities/partner-opening-balance.entity';

/** Customer / supplier opening balances (أرصدة أول المدة). */
@ApiTags('payments')
@ApiBearerAuth()
@Controller('partner-opening-balances')
export class OpeningBalancesController {
  constructor(private readonly openingBalances: OpeningBalancesService) {}

  @RequirePermissions({ module: 'accounting', screen: 'opening_balances', action: 'create' })
  @Post()
  @ApiOperation({ summary: 'Create a customer/supplier opening balance document (OB-)' })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateOpeningBalanceDto,
  ) {
    return this.openingBalances.create(tenantId, user.sub, dto);
  }

  @RequirePermissions({ module: 'accounting', screen: 'opening_balances', action: 'read' })
  @Get()
  @ApiQuery({ name: 'status', required: false, enum: OpeningBalanceStatus })
  findAll(@CurrentTenant() tenantId: string, @Query('status') status?: OpeningBalanceStatus) {
    return this.openingBalances.findAll(tenantId, status);
  }

  @RequirePermissions({ module: 'accounting', screen: 'opening_balances', action: 'read' })
  @Get(':id')
  findById(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.openingBalances.findById(tenantId, id);
  }

  @RequirePermissions({ module: 'accounting', screen: 'opening_balances', action: 'update' })
  @Post(':id/post')
  post(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.openingBalances.post(tenantId, user.sub, id);
  }

  @RequirePermissions({ module: 'accounting', screen: 'opening_balances', action: 'update' })
  @Post(':id/cancel')
  cancel(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.openingBalances.cancel(tenantId, user.sub, id);
  }
}
