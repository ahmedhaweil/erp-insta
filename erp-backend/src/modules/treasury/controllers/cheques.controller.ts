import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { ChequesService } from '../services/cheques.service';
import {
  BounceChequeDto,
  ChequeDueQueryDto,
  ChequeQueryDto,
  DepositChequeDto,
  EndorseChequeDto,
  ReturnChequeDto,
  SettleChequeDto,
} from '../dto/treasury.dto';

/**
 * Cheques are created through POST /payments with method "cheque" (and
 * `cheque` details); these endpoints drive their lifecycle.
 */
@ApiTags('treasury')
@ApiBearerAuth()
@Controller('treasury/cheques')
export class ChequesController {
  constructor(private readonly cheques: ChequesService) {}

  @RequirePermissions({ module: 'treasury', screen: 'cheques', action: 'read' })
  @Get()
  findAll(@CurrentTenant() tenantId: string, @Query() query: ChequeQueryDto) {
    return this.cheques.findAll(tenantId, query);
  }

  @RequirePermissions({ module: 'treasury', screen: 'cheques', action: 'read' })
  @Get('due')
  @ApiOperation({ summary: 'Cheque calendar: outstanding cheques due in a date range' })
  due(@CurrentTenant() tenantId: string, @Query() query: ChequeDueQueryDto) {
    return this.cheques.due(tenantId, query);
  }

  @RequirePermissions({ module: 'treasury', screen: 'cheques', action: 'read' })
  @Get(':id')
  findById(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.cheques.findById(tenantId, id);
  }

  @RequirePermissions({ module: 'treasury', screen: 'cheques', action: 'update' })
  @Post(':id/deposit')
  deposit(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: DepositChequeDto,
  ) {
    return this.cheques.deposit(tenantId, user.sub, id, dto);
  }

  @RequirePermissions({ module: 'treasury', screen: 'cheques', action: 'update' })
  @Post(':id/collect')
  collect(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: SettleChequeDto,
  ) {
    return this.cheques.collect(tenantId, user.sub, id, dto);
  }

  @RequirePermissions({ module: 'treasury', screen: 'cheques', action: 'update' })
  @Post(':id/clear')
  clear(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: SettleChequeDto,
  ) {
    return this.cheques.clear(tenantId, user.sub, id, dto);
  }

  @RequirePermissions({ module: 'treasury', screen: 'cheques', action: 'update' })
  @Post(':id/bounce')
  bounce(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: BounceChequeDto,
  ) {
    return this.cheques.bounce(tenantId, user.sub, id, dto);
  }

  @RequirePermissions({ module: 'treasury', screen: 'cheques', action: 'update' })
  @Post(':id/return')
  returnToPartner(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ReturnChequeDto,
  ) {
    return this.cheques.returnToPartner(tenantId, user.sub, id, dto);
  }

  @RequirePermissions({ module: 'treasury', screen: 'cheques', action: 'update' })
  @Post(':id/endorse')
  endorse(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: EndorseChequeDto,
  ) {
    return this.cheques.endorse(tenantId, user.sub, id, dto);
  }

  @RequirePermissions({ module: 'treasury', screen: 'cheques', action: 'cancel' })
  @Post(':id/cancel')
  cancel(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.cheques.cancel(tenantId, user.sub, id);
  }
}
