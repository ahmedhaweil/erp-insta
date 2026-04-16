import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FinancialReportsService } from '../services/financial-reports.service';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { DateRangeFilterDto, BalanceSheetFilterDto, GeneralLedgerFilterDto } from '../dto/report-filter.dto';

@ApiTags('reports')
@Controller('reports')
export class FinancialReportsController {
  constructor(private readonly reportsService: FinancialReportsService) {}

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
}
