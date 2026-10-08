import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { BankReconciliationService } from '../services/bank-reconciliation.service';
import {
  AutoMatchDto,
  ImportStatementDto,
  ManualMatchDto,
  StatementLineVoucherDto,
} from '../dto/treasury.dto';

@ApiTags('treasury')
@ApiBearerAuth()
@Controller('treasury/bank-statements')
export class BankReconciliationController {
  constructor(private readonly reconciliation: BankReconciliationService) {}

  @RequirePermissions({ module: 'treasury', screen: 'reconciliation', action: 'read' })
  @Get()
  @ApiQuery({ name: 'treasuryId', required: false })
  findAll(@CurrentTenant() tenantId: string, @Query('treasuryId') treasuryId?: string) {
    return this.reconciliation.findAll(tenantId, treasuryId);
  }

  @RequirePermissions({ module: 'treasury', screen: 'reconciliation', action: 'create' })
  @Post()
  @ApiOperation({ summary: 'Import a bank statement (JSON lines and/or CSV text)' })
  import(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: ImportStatementDto,
  ) {
    return this.reconciliation.import(tenantId, user.sub, dto);
  }

  @RequirePermissions({ module: 'treasury', screen: 'reconciliation', action: 'read' })
  @Get(':id')
  findById(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.reconciliation.findById(tenantId, id);
  }

  @RequirePermissions({ module: 'treasury', screen: 'reconciliation', action: 'delete' })
  @Delete(':id')
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.reconciliation.remove(tenantId, id);
  }

  @RequirePermissions({ module: 'treasury', screen: 'reconciliation', action: 'read' })
  @Get(':id/report')
  @ApiOperation({ summary: 'Reconciliation report: book vs statement balance, outstanding items' })
  report(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.reconciliation.report(tenantId, id);
  }

  @RequirePermissions({ module: 'treasury', screen: 'reconciliation', action: 'update' })
  @Post(':id/auto-match')
  autoMatch(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: AutoMatchDto,
  ) {
    return this.reconciliation.autoMatch(tenantId, id, dto);
  }

  @RequirePermissions({ module: 'treasury', screen: 'reconciliation', action: 'update' })
  @Post(':id/close')
  close(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.reconciliation.close(tenantId, id);
  }

  @RequirePermissions({ module: 'treasury', screen: 'reconciliation', action: 'update' })
  @Post(':id/reopen')
  reopen(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.reconciliation.reopen(tenantId, id);
  }

  @RequirePermissions({ module: 'treasury', screen: 'reconciliation', action: 'update' })
  @Post('lines/:lineId/match')
  match(
    @CurrentTenant() tenantId: string,
    @Param('lineId') lineId: string,
    @Body() dto: ManualMatchDto,
  ) {
    return this.reconciliation.match(tenantId, lineId, dto);
  }

  @RequirePermissions({ module: 'treasury', screen: 'reconciliation', action: 'update' })
  @Post('lines/:lineId/unmatch')
  unmatch(@CurrentTenant() tenantId: string, @Param('lineId') lineId: string) {
    return this.reconciliation.unmatch(tenantId, lineId);
  }

  @RequirePermissions({ module: 'treasury', screen: 'reconciliation', action: 'update' })
  @Post('lines/:lineId/voucher')
  @ApiOperation({ summary: 'Book an unmatched bank item as a posted voucher and match it' })
  createVoucher(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('lineId') lineId: string,
    @Body() dto: StatementLineVoucherDto,
  ) {
    return this.reconciliation.createVoucher(tenantId, user.sub, lineId, dto);
  }
}
