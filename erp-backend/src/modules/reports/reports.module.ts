import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JournalLine } from '@modules/accounting/entities/journal-line.entity';
import { JournalEntry } from '@modules/accounting/entities/journal-entry.entity';
import { Account } from '@modules/accounting/entities/account.entity';
import { SalesInvoice } from '@modules/sales/entities/sales-invoice.entity';
import { PurchaseInvoice } from '@modules/purchasing/entities/purchase-invoice.entity';
import { SalesOrder } from '@modules/sales/entities/sales-order.entity';
import { Stock } from '@modules/inventory/entities/stock.entity';
import { Product } from '@modules/inventory/entities/product.entity';
import { Notification } from '@modules/notifications/entities/notification.entity';
import { FinancialReportsService } from './services/financial-reports.service';
import { DashboardService } from './services/dashboard.service';
import { ManagementReportsService } from './services/management-reports.service';
import { Budget } from '@modules/accounting/entities/budget.entity';
import { FiscalYear } from '@modules/accounting/entities/fiscal-year.entity';
import { FinancialReportsController } from './controllers/financial-reports.controller';
import { DashboardController } from './controllers/dashboard.controller';
import { AnalysisReportsController } from './controllers/analysis-reports.controller';
import { LedgerReportsService } from './services/ledger-reports.service';
import { PartnerStatementService } from './services/partner-statement.service';
import { SalesAnalysisService } from './services/sales-analysis.service';
import { VatReturnService } from './services/vat-return.service';
import { ReportExportService } from './export/report-export.service';
import { AccountingSettings } from '@modules/accounting/entities/accounting-settings.entity';
import { CostCenter } from '@modules/accounting/entities/cost-center.entity';
import { Branch } from '@modules/tenants/entities/branch.entity';
import { Tenant } from '@modules/tenants/entities/tenant.entity';
import { Payment } from '@modules/payments/entities/payment.entity';
import { PaymentAllocation } from '@modules/payments/entities/payment-allocation.entity';
import { PartnerWriteOff } from '@modules/payments/entities/partner-write-off.entity';
import { Customer } from '@modules/sales/entities/customer.entity';
import { Supplier } from '@modules/purchasing/entities/supplier.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      JournalLine,
      JournalEntry,
      Account,
      SalesInvoice,
      PurchaseInvoice,
      SalesOrder,
      Stock,
      Product,
      Notification,
      Budget,
      FiscalYear,
      AccountingSettings,
      CostCenter,
      Branch,
      Tenant,
      Payment,
      PaymentAllocation,
      PartnerWriteOff,
      Customer,
      Supplier,
    ]),
  ],
  controllers: [FinancialReportsController, AnalysisReportsController, DashboardController],
  providers: [
    FinancialReportsService,
    DashboardService,
    ManagementReportsService,
    LedgerReportsService,
    PartnerStatementService,
    SalesAnalysisService,
    VatReturnService,
    ReportExportService,
  ],
  exports: [FinancialReportsService, DashboardService, ReportExportService, SalesAnalysisService],
})
export class ReportsModule {}
