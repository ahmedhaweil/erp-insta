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
import { AccountsService } from './services/accounts.service';
import { JournalEntriesService } from './services/journal-entries.service';
import { AccountsController } from './controllers/accounts.controller';
import { JournalEntriesController } from './controllers/journal-entries.controller';

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
    ]),
  ],
  controllers: [AccountsController, JournalEntriesController],
  providers: [AccountsService, JournalEntriesService],
  exports: [AccountsService, JournalEntriesService],
})
export class AccountingModule {}
