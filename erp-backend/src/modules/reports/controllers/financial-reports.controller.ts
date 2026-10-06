import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FinancialReportsService } from '../services/financial-reports.service';
import { ManagementReportsService } from '../services/management-reports.service';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { DateRangeFilterDto, BalanceSheetFilterDto, GeneralLedgerFilterDto } from '../dto/report-filter.dto';

@ApiTags('reports')
@Controller('reports')
export class FinancialReportsController {
  constructor(
    private readonly reportsService: FinancialReportsService,
    private readonly managementReports: ManagementReportsService,
  ) {}

  @Get('trial-balance')
  getTrialBalance(
    @CurrentTenant() tenantId: string,
    @Query() filter: DateRangeFilterDto,
  ) {
    return this.reportsService.getTrialBalance(tenantId, filter.from, filter.to);
  }

  @Get('profit-loss')
  getProfitAndLoss(
    @CurrentTenant() tenantId: string,
    @Query() filter: DateRangeFilterDto,
  ) {
    return this.reportsService.getProfitAndLoss(tenantId, filter.from, filter.to);
  }

  @Get('balance-sheet')
  getBalanceSheet(
    @CurrentTenant() tenantId: string,
    @Query() filter: BalanceSheetFilterDto,
  ) {
    return this.reportsService.getBalanceSheet(tenantId, filter.asOf);
  }

  @Get('general-ledger')
  getGeneralLedger(
    @CurrentTenant() tenantId: string,
    @Query() filter: GeneralLedgerFilterDto,
  ) {
    return this.reportsService.getGeneralLedger(
      tenantId,
      filter.accountId!,
      filter.from,
      filter.to,
    );
  }

  @Get('aged-receivables')
  getAgedReceivables(@CurrentTenant() tenantId: string, @Query() filter: BalanceSheetFilterDto) {
    return this.managementReports.getAgedReceivables(tenantId, filter.asOf);
  }

  @Get('aged-payables')
  getAgedPayables(@CurrentTenant() tenantId: string, @Query() filter: BalanceSheetFilterDto) {
    return this.managementReports.getAgedPayables(tenantId, filter.asOf);
  }

  @Get('budget-vs-actual')
  getBudgetVsActual(@CurrentTenant() tenantId: string, @Query('fiscalYearId') fiscalYearId: string) {
    return this.managementReports.getBudgetVsActual(tenantId, fiscalYearId);
  }
}
