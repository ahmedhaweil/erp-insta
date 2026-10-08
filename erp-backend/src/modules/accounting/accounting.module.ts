import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from './entities/account.entity';
import { Journal } from './entities/journal.entity';
import { JournalEntry } from './entities/journal-entry.entity';
import { JournalLine } from './entities/journal-line.entity';
import { CostCenter } from './entities/cost-center.entity';
import { FixedAsset } from './entities/fixed-asset.entity';
import { FiscalYear } from './entities/fiscal-year.entity';
import { Currency } from './entities/currency.entity';
import { ExchangeRate } from './entities/exchange-rate.entity';
import { Budget } from './entities/budget.entity';
import { AccountingSettings } from './entities/accounting-settings.entity';
import { AccountsService } from './services/accounts.service';
import { JournalEntriesService } from './services/journal-entries.service';
import { AccountingSettingsService } from './services/accounting-settings.service';
import { AutoPostingService } from './services/auto-posting.service';
import { FixedAssetsService } from './services/fixed-assets.service';
import { FiscalYearsService } from './services/fiscal-years.service';
import { AccountsController } from './controllers/accounts.controller';
import { JournalEntriesController } from './controllers/journal-entries.controller';
import { AccountingConfigController } from './controllers/accounting-config.controller';
import { AccountingSetupService } from './services/accounting-setup.service';
import { Tenant } from '@modules/tenants/entities/tenant.entity';
import {
  RecurringEntry,
  RecurringEntryLine,
  RecurringEntryRun,
} from './entities/recurring-entry.entity';
import { DeferralSchedule, DeferralScheduleLine } from './entities/deferral-schedule.entity';
import { FxRevaluation, OpeningBalance, PeriodClosing } from './entities/closing.entities';
import { SalesInvoice } from '@modules/sales/entities/sales-invoice.entity';
import { PurchaseInvoice } from '@modules/purchasing/entities/purchase-invoice.entity';
import { Customer } from '@modules/sales/entities/customer.entity';
import { Supplier } from '@modules/purchasing/entities/supplier.entity';
import { RecurringEntriesService } from './services/recurring-entries.service';
import { DeferralsService } from './services/deferrals.service';
import { FxRevaluationService } from './services/fx-revaluation.service';
import { OpeningBalancesService } from './services/opening-balances.service';
import { PeriodClosingService } from './services/period-closing.service';
import { AccountingSchedulerService } from './services/accounting-scheduler.service';
import { AccountingDepthController } from './controllers/accounting-depth.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Account,
      Journal,
      JournalEntry,
      JournalLine,
      CostCenter,
      FixedAsset,
      FiscalYear,
      Currency,
      ExchangeRate,
      Budget,
      AccountingSettings,
      Tenant,
      RecurringEntry,
      RecurringEntryLine,
      RecurringEntryRun,
      DeferralSchedule,
      DeferralScheduleLine,
      FxRevaluation,
      OpeningBalance,
      PeriodClosing,
      // Read/written by opening balances only (no module import, to avoid cycles).
      SalesInvoice,
      PurchaseInvoice,
      Customer,
      Supplier,
    ]),
  ],
  controllers: [
    AccountsController,
    JournalEntriesController,
    AccountingConfigController,
    AccountingDepthController,
  ],
  providers: [
    AccountsService,
    JournalEntriesService,
    AccountingSettingsService,
    AutoPostingService,
    FixedAssetsService,
    FiscalYearsService,
    AccountingSetupService,
    RecurringEntriesService,
    DeferralsService,
    FxRevaluationService,
    OpeningBalancesService,
    PeriodClosingService,
    AccountingSchedulerService,
  ],
  exports: [
    AccountsService,
    JournalEntriesService,
    AccountingSettingsService,
    AutoPostingService,
    AccountingSetupService,
  ],
})
export class AccountingModule {}
