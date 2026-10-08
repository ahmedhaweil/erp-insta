import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Treasury } from './entities/treasury.entity';
import { TreasuryVoucher, TreasuryVoucherLine } from './entities/treasury-voucher.entity';
import { TreasuryTransfer } from './entities/treasury-transfer.entity';
import { Cheque } from './entities/cheque.entity';
import {
  BankReconciliationMatch,
  BankStatement,
  BankStatementLine,
} from './entities/bank-statement.entity';
import { Account } from '@modules/accounting/entities/account.entity';
import { JournalLine } from '@modules/accounting/entities/journal-line.entity';
import { AccountingModule } from '@modules/accounting/accounting.module';
import { PaymentsModule } from '@modules/payments/payments.module';
import { AuthModule } from '@modules/auth/auth.module';
import { SalesModule } from '@modules/sales/sales.module';
import { TreasuryLedgerService } from './services/treasury-ledger.service';
import { TreasuriesService } from './services/treasuries.service';
import { VouchersService } from './services/vouchers.service';
import { TransfersService } from './services/transfers.service';
import { ChequesService } from './services/cheques.service';
import { BankReconciliationService } from './services/bank-reconciliation.service';
import { TreasuriesController } from './controllers/treasuries.controller';
import { VouchersController } from './controllers/vouchers.controller';
import { TransfersController } from './controllers/transfers.controller';
import { ChequesController } from './controllers/cheques.controller';
import { BankReconciliationController } from './controllers/bank-reconciliation.controller';

/**
 * Treasury, cheques and banks: cash boxes and bank accounts, receipt and
 * payment vouchers, transfers, cheque lifecycle and bank reconciliation.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Treasury,
      TreasuryVoucher,
      TreasuryVoucherLine,
      TreasuryTransfer,
      Cheque,
      BankStatement,
      BankStatementLine,
      BankReconciliationMatch,
      Account,
      JournalLine,
    ]),
    AccountingModule,
    AuthModule,
    PaymentsModule,
    SalesModule,
  ],
  controllers: [
    TreasuriesController,
    VouchersController,
    TransfersController,
    ChequesController,
    BankReconciliationController,
  ],
  providers: [
    TreasuryLedgerService,
    TreasuriesService,
    VouchersService,
    TransfersService,
    ChequesService,
    BankReconciliationService,
  ],
  exports: [TreasuriesService, TreasuryLedgerService, VouchersService],
})
export class TreasuryModule {}
