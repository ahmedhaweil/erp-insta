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
    ]),
  ],
  controllers: [AccountsController, JournalEntriesController, AccountingConfigController],
  providers: [
    AccountsService,
    JournalEntriesService,
    AccountingSettingsService,
    AutoPostingService,
    FixedAssetsService,
    FiscalYearsService,
  ],
  exports: [
    AccountsService,
    JournalEntriesService,
    AccountingSettingsService,
    AutoPostingService,
  ],
})
export class AccountingModule {}
