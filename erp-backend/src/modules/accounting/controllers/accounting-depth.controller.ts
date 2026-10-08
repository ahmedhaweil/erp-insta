import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { RecurringEntriesService } from '../services/recurring-entries.service';
import { DeferralsService } from '../services/deferrals.service';
import { FxRevaluationService } from '../services/fx-revaluation.service';
import { OpeningBalancesService } from '../services/opening-balances.service';
import { PeriodClosingService } from '../services/period-closing.service';
import { DeferralType } from '../entities/deferral-schedule.entity';
import { OpeningBalanceKind } from '../entities/closing.entity';
import {
  CancelDeferralDto,
  CreateDeferralDto,
  CreateRecurringEntryDto,
  FxRevaluationDto,
  OpeningAccountsDto,
  OpeningPartnersDto,
  PeriodLockDto,
  PeriodReopenDto,
  ReverseRevaluationDto,
  RunDueDto,
  UpdateRecurringEntryDto,
} from '../dto/accounting-depth.dto';
import { today } from '@shared/utils/document-totals.util';

const perm = (screen: string, action: string) => ({ module: 'accounting', screen, action });

@ApiTags('accounting')
@ApiBearerAuth()
@Controller('accounting')
export class AccountingDepthController {
  constructor(
    private readonly recurring: RecurringEntriesService,
    private readonly deferrals: DeferralsService,
    private readonly revaluations: FxRevaluationService,
    private readonly openings: OpeningBalancesService,
    private readonly closing: PeriodClosingService,
  ) {}

  // ------------------------------------------------- recurring entries

  @RequirePermissions(perm('recurring', 'read'))
  @Get('recurring-entries')
  findRecurring(@CurrentTenant() tenantId: string) {
    return this.recurring.findAll(tenantId);
  }

  @RequirePermissions(perm('recurring', 'create'))
  @Post('recurring-entries')
  createRecurring(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateRecurringEntryDto,
  ) {
    return this.recurring.create(tenantId, user.sub, dto);
  }

  @RequirePermissions(perm('recurring', 'post'))
  @Post('recurring-entries/run-due')
  @ApiOperation({ summary: 'Generate every recurring entry due up to asOf (idempotent)' })
  runRecurring(@CurrentTenant() tenantId: string, @Body() dto: RunDueDto) {
    return this.recurring.runDue(tenantId, dto.asOf ?? today());
  }

  @RequirePermissions(perm('recurring', 'read'))
  @Get('recurring-entries/:id')
  async findRecurringById(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    const template = await this.recurring.findById(tenantId, id);
    return {
      ...template,
      upcoming: await this.recurring.preview(tenantId, id, 6),
      runs: await this.recurring.runs(tenantId, id),
    };
  }

  @RequirePermissions(perm('recurring', 'update'))
  @Patch('recurring-entries/:id')
  updateRecurring(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRecurringEntryDto,
  ) {
    return this.recurring.update(tenantId, id, dto);
  }

  @RequirePermissions(perm('recurring', 'post'))
  @Post('recurring-entries/:id/run')
  runOneRecurring(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RunDueDto,
  ) {
    return this.recurring.runDue(tenantId, dto.asOf ?? today(), id);
  }

  // ------------------------------------------------------- deferrals

  @RequirePermissions(perm('deferrals', 'read'))
  @Get('deferrals')
  @ApiQuery({ name: 'type', required: false, enum: DeferralType })
  findDeferrals(@CurrentTenant() tenantId: string, @Query('type') type?: DeferralType) {
    return this.deferrals.findAll(tenantId, type);
  }

  @RequirePermissions(perm('deferrals', 'create'))
  @Post('deferrals')
  createDeferral(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateDeferralDto,
  ) {
    return this.deferrals.create(tenantId, user.sub, dto);
  }

  @RequirePermissions(perm('deferrals', 'post'))
  @Post('deferrals/run-due')
  @ApiOperation({ summary: 'Post every monthly recognition due up to asOf (idempotent)' })
  runDeferrals(@CurrentTenant() tenantId: string, @Body() dto: RunDueDto) {
    return this.deferrals.runDue(tenantId, dto.asOf ?? today());
  }

  @RequirePermissions(perm('deferrals', 'read'))
  @Get('deferrals/:id')
  findDeferral(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.deferrals.findById(tenantId, id);
  }

  @RequirePermissions(perm('deferrals', 'update'))
  @Post('deferrals/:id/cancel')
  cancelDeferral(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelDeferralDto,
  ) {
    return this.deferrals.cancel(tenantId, user.sub, id, dto);
  }

  // -------------------------------------------------- fx revaluation

  @RequirePermissions(perm('revaluation', 'read'))
  @Get('fx-revaluations')
  findRevaluations(@CurrentTenant() tenantId: string) {
    return this.revaluations.findAll(tenantId);
  }

  @RequirePermissions(perm('revaluation', 'read'))
  @Post('fx-revaluations/preview')
  @ApiOperation({ summary: 'Compute the unrealised exchange differences without posting' })
  previewRevaluation(@CurrentTenant() tenantId: string, @Body() dto: FxRevaluationDto) {
    return this.revaluations.preview(tenantId, dto);
  }

  @RequirePermissions(perm('revaluation', 'post'))
  @Post('fx-revaluations')
  @ApiOperation({ summary: 'Post the revaluation and its reversal on the first day of the next period' })
  postRevaluation(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: FxRevaluationDto,
  ) {
    return this.revaluations.post(tenantId, user.sub, dto);
  }

  @RequirePermissions(perm('revaluation', 'read'))
  @Get('fx-revaluations/:id')
  findRevaluation(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.revaluations.findById(tenantId, id);
  }

  @RequirePermissions(perm('revaluation', 'post'))
  @Post('fx-revaluations/:id/reverse')
  reverseRevaluation(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReverseRevaluationDto,
  ) {
    return this.revaluations.reverse(tenantId, user.sub, id, dto.date);
  }

  // ------------------------------------------------ opening balances

  @RequirePermissions(perm('opening', 'read'))
  @Get('opening-balances')
  @ApiQuery({ name: 'kind', required: false, enum: OpeningBalanceKind })
  findOpenings(@CurrentTenant() tenantId: string, @Query('kind') kind?: OpeningBalanceKind) {
    return this.openings.findAll(tenantId, kind);
  }

  @RequirePermissions(perm('opening', 'post'))
  @Post('opening-balances/accounts')
  @ApiOperation({ summary: 'Post the opening entry of account balances (difference to equity)' })
  postOpeningAccounts(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: OpeningAccountsDto,
  ) {
    return this.openings.postAccounts(tenantId, user.sub, dto);
  }

  @RequirePermissions(perm('opening', 'post'))
  @Post('opening-balances/partners')
  @ApiOperation({ summary: 'Create posted opening invoices / bills per customer / supplier' })
  postOpeningPartners(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: OpeningPartnersDto,
  ) {
    return this.openings.postPartners(tenantId, user.sub, dto);
  }

  // --------------------------------------------------- period closing

  @RequirePermissions(perm('closing', 'read'))
  @Get('period-closing/checklist')
  @ApiQuery({ name: 'date', required: false, description: 'Period end (default today)' })
  @ApiQuery({ name: 'period', required: false, description: 'YYYY-MM' })
  checklist(
    @CurrentTenant() tenantId: string,
    @Query('date') date?: string,
    @Query('period') period?: string,
  ) {
    const end = date ?? (period && /^\d{4}-\d{2}$/.test(period) ? periodEndOf(period) : today());
    return this.closing.checklist(tenantId, end);
  }

  @RequirePermissions(perm('closing', 'read'))
  @Get('period-closing/history')
  closingHistory(@CurrentTenant() tenantId: string) {
    return this.closing.history(tenantId);
  }

  @RequirePermissions(perm('closing', 'update'))
  @Post('period-closing/lock')
  @ApiOperation({ summary: 'Lock the books up to a month end; open items are returned as warnings' })
  lock(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Body() dto: PeriodLockDto) {
    return this.closing.lock(tenantId, user.sub, dto);
  }

  @RequirePermissions(perm('closing', 'update'))
  @Post('period-closing/reopen')
  reopen(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Body() dto: PeriodReopenDto) {
    return this.closing.reopen(tenantId, user.sub, dto);
  }
}

function periodEndOf(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().split('T')[0];
}
