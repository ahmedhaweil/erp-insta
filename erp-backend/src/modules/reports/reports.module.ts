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
    ]),
  ],
  controllers: [FinancialReportsController, DashboardController],
  providers: [FinancialReportsService, DashboardService, ManagementReportsService],
  exports: [FinancialReportsService, DashboardService],
})
export class ReportsModule {}
