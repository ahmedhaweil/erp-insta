import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { PartnerStatementService } from '../services/partner-statement.service';
import { SalesAnalysisService } from '../services/sales-analysis.service';
import { VatReturnService } from '../services/vat-return.service';
import { ReportExportService } from '../export/report-export.service';
import {
  analysisSpec,
  dailySummarySpec,
  partnerStatementSpec,
  vatReturnSpec,
} from '../export/report-specs';
import {
  DailySummaryFilterDto,
  PartnerStatementFilterDto,
  PurchaseAnalysisFilterDto,
  SalesAnalysisFilterDto,
  VatReturnFilterDto,
} from '../dto/report-filter.dto';

/** Document-based reports. Every endpoint accepts ?format=xlsx and ?lang=ar|en. */
@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class AnalysisReportsController {
  constructor(
    private readonly statements: PartnerStatementService,
    private readonly analysis: SalesAnalysisService,
    private readonly vat: VatReturnService,
    private readonly exporter: ReportExportService,
  ) {}

  @ApiOperation({ summary: 'Customer / supplier statement of account (كشف حساب)' })
  @RequirePermissions({ module: 'reports', screen: 'partners', action: 'read' })
  @Get('partner-statement')
  async getPartnerStatement(@CurrentTenant() tenantId: string, @Query() q: PartnerStatementFilterDto) {
    const data = await this.statements.getStatement(tenantId, q);
    return this.exporter.respond(q.format, q.lang, data, partnerStatementSpec);
  }

  @ApiOperation({ summary: 'VAT return (Egypt monthly return / Saudi ZATCA return) from documents' })
  @RequirePermissions({ module: 'reports', screen: 'tax', action: 'read' })
  @Get('vat-return')
  async getVatReturn(@CurrentTenant() tenantId: string, @Query() q: VatReturnFilterDto) {
    const data = await this.vat.getVatReturn(tenantId, q);
    return this.exporter.respond(q.format, q.lang, data, vatReturnSpec);
  }

  @ApiOperation({
    summary:
      'Sales analysis by product, customer, category, branch, salesperson, month, day or invoice with gross profit',
  })
  @RequirePermissions({ module: 'reports', screen: 'sales', action: 'read' })
  @Get('sales-analysis')
  async getSalesAnalysis(@CurrentTenant() tenantId: string, @Query() q: SalesAnalysisFilterDto) {
    const data = await this.analysis.salesAnalysis(tenantId, q);
    return this.exporter.respond(q.format, q.lang, data, (d) => analysisSpec(d, 'sales'));
  }

  @ApiOperation({ summary: 'Purchase analysis by supplier, product, category, branch, month or invoice' })
  @RequirePermissions({ module: 'reports', screen: 'purchases', action: 'read' })
  @Get('purchase-analysis')
  async getPurchaseAnalysis(@CurrentTenant() tenantId: string, @Query() q: PurchaseAnalysisFilterDto) {
    const data = await this.analysis.purchaseAnalysis(tenantId, q);
    return this.exporter.respond(q.format, q.lang, data, (d) => analysisSpec(d, 'purchases'));
  }

  @ApiOperation({ summary: 'Daily sales and cash summary per day and user (POS + invoices + payments)' })
  @RequirePermissions({ module: 'reports', screen: 'sales', action: 'read' })
  @Get('daily-summary')
  async getDailySummary(@CurrentTenant() tenantId: string, @Query() q: DailySummaryFilterDto) {
    const data = await this.analysis.dailySummary(tenantId, q);
    return this.exporter.respond(q.format, q.lang, data, dailySummarySpec);
  }
}
