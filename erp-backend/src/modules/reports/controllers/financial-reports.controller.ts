import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FinancialReportsService } from '../services/financial-reports.service';
import { ManagementReportsService } from '../services/management-reports.service';
import { LedgerReportsService } from '../services/ledger-reports.service';
import { ReportExportService } from '../export/report-export.service';
import {
  agedSpec,
  balanceSheetSpec,
  budgetSpec,
  cashFlowSpec,
  dimensionPnlSpec,
  generalLedgerSpec,
  profitLossSpec,
  trialBalanceSpec,
} from '../export/report-specs';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import {
  BalanceSheetFilterDto,
  BudgetFilterDto,
  DateRangeFilterDto,
  GeneralLedgerFilterDto,
  LedgerFilterDto,
  TrialBalanceFilterDto,
} from '../dto/report-filter.dto';

/** Every endpoint accepts ?format=xlsx (Excel download) and ?lang=ar|en. */
@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class FinancialReportsController {
  constructor(
    private readonly reportsService: FinancialReportsService,
    private readonly managementReports: ManagementReportsService,
    private readonly ledgerReports: LedgerReportsService,
    private readonly exporter: ReportExportService,
  ) {}

  @ApiOperation({ summary: 'Trial balance with opening, period and closing columns' })
  @RequirePermissions({ module: 'reports', screen: 'financial', action: 'read' })
  @Get('trial-balance')
  async getTrialBalance(@CurrentTenant() tenantId: string, @Query() q: TrialBalanceFilterDto) {
    const data = await this.ledgerReports.trialBalance(tenantId, q);
    return this.exporter.respond(q.format, q.lang, data, trialBalanceSpec);
  }

  @RequirePermissions({ module: 'reports', screen: 'financial', action: 'read' })
  @Get('profit-loss')
  async getProfitAndLoss(@CurrentTenant() tenantId: string, @Query() q: DateRangeFilterDto) {
    const data = await this.reportsService.getProfitAndLoss(tenantId, q.from, q.to);
    return this.exporter.respond(q.format, q.lang, data, (d) => profitLossSpec(d, q.from, q.to));
  }

  @RequirePermissions({ module: 'reports', screen: 'financial', action: 'read' })
  @Get('balance-sheet')
  async getBalanceSheet(@CurrentTenant() tenantId: string, @Query() q: BalanceSheetFilterDto) {
    const data = await this.reportsService.getBalanceSheet(tenantId, q.asOf);
    return this.exporter.respond(q.format, q.lang, data, (d) => balanceSheetSpec(d, q.asOf));
  }

  @ApiOperation({ summary: 'General ledger of an account with opening and running balance' })
  @RequirePermissions({ module: 'reports', screen: 'financial', action: 'read' })
  @Get('general-ledger')
  async getGeneralLedger(@CurrentTenant() tenantId: string, @Query() q: GeneralLedgerFilterDto) {
    const data = await this.ledgerReports.generalLedger(tenantId, q);
    return this.exporter.respond(q.format, q.lang, data, generalLedgerSpec);
  }

  @ApiOperation({
    summary: 'Account statement: general ledger including sub-accounts, filterable by cost center and branch',
  })
  @RequirePermissions({ module: 'reports', screen: 'financial', action: 'read' })
  @Get('account-statement')
  async getAccountStatement(@CurrentTenant() tenantId: string, @Query() q: GeneralLedgerFilterDto) {
    const data = await this.ledgerReports.generalLedger(tenantId, {
      ...q,
      includeChildren: q.includeChildren ?? true,
    });
    return this.exporter.respond(q.format, q.lang, data, generalLedgerSpec);
  }

  @ApiOperation({ summary: 'Cash flow statement (indirect method)' })
  @RequirePermissions({ module: 'reports', screen: 'financial', action: 'read' })
  @Get('cash-flow')
  async getCashFlow(@CurrentTenant() tenantId: string, @Query() q: DateRangeFilterDto) {
    const data = await this.ledgerReports.cashFlow(tenantId, q);
    return this.exporter.respond(q.format, q.lang, data, cashFlowSpec);
  }

  @ApiOperation({ summary: 'Profit and loss per cost center' })
  @RequirePermissions({ module: 'reports', screen: 'cost-centers', action: 'read' })
  @Get('cost-center-pnl')
  async getCostCenterPnl(@CurrentTenant() tenantId: string, @Query() q: LedgerFilterDto) {
    const data = await this.ledgerReports.profitAndLossBy('cost_center', tenantId, q);
    return this.exporter.respond(q.format, q.lang, data, dimensionPnlSpec);
  }

  @ApiOperation({ summary: 'Profit and loss per branch' })
  @RequirePermissions({ module: 'reports', screen: 'branches', action: 'read' })
  @Get('branch-pnl')
  async getBranchPnl(@CurrentTenant() tenantId: string, @Query() q: LedgerFilterDto) {
    const data = await this.ledgerReports.profitAndLossBy('branch', tenantId, q);
    return this.exporter.respond(q.format, q.lang, data, dimensionPnlSpec);
  }

  @RequirePermissions({ module: 'reports', screen: 'partners', action: 'read' })
  @Get('aged-receivables')
  async getAgedReceivables(@CurrentTenant() tenantId: string, @Query() q: BalanceSheetFilterDto) {
    const data = await this.managementReports.getAgedReceivables(tenantId, q.asOf);
    return this.exporter.respond(q.format, q.lang, data, (d) => agedSpec(d, false));
  }

  @RequirePermissions({ module: 'reports', screen: 'partners', action: 'read' })
  @Get('aged-payables')
  async getAgedPayables(@CurrentTenant() tenantId: string, @Query() q: BalanceSheetFilterDto) {
    const data = await this.managementReports.getAgedPayables(tenantId, q.asOf);
    return this.exporter.respond(q.format, q.lang, data, (d) => agedSpec(d, true));
  }

  @RequirePermissions({ module: 'reports', screen: 'budgets', action: 'read' })
  @Get('budget-vs-actual')
  async getBudgetVsActual(@CurrentTenant() tenantId: string, @Query() q: BudgetFilterDto) {
    const data = await this.managementReports.getBudgetVsActual(tenantId, q.fiscalYearId);
    return this.exporter.respond(q.format, q.lang, data, budgetSpec);
  }
}
