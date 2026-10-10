import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from './entities/payment.entity';
import { PaymentAllocation } from './entities/payment-allocation.entity';
import { PartnerWriteOff, PartnerWriteOffLine } from './entities/partner-write-off.entity';
import {
  PartnerOpeningBalance,
  PartnerOpeningBalanceLine,
} from './entities/partner-opening-balance.entity';
import { Customer } from '@modules/sales/entities/customer.entity';
import { Supplier } from '@modules/purchasing/entities/supplier.entity';
import { SalesInvoice } from '@modules/sales/entities/sales-invoice.entity';
import { PurchaseInvoice } from '@modules/purchasing/entities/purchase-invoice.entity';
import { Treasury } from '@modules/treasury/entities/treasury.entity';
import { Cheque } from '@modules/treasury/entities/cheque.entity';
import { Account } from '@modules/accounting/entities/account.entity';
import { PaymentsService } from './services/payments.service';
import { WriteOffsService } from './services/write-offs.service';
import { OpeningBalancesService } from './services/opening-balances.service';
import { PaymentsController } from './controllers/payments.controller';
import {
  PurchaseWriteOffsController,
  SalesWriteOffsController,
} from './controllers/write-offs.controller';
import { OpeningBalancesController } from './controllers/opening-balances.controller';
import { AccountingModule } from '@modules/accounting/accounting.module';
import { SalesModule } from '@modules/sales/sales.module';
import { PurchasingModule } from '@modules/purchasing/purchasing.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Payment,
      PaymentAllocation,
      PartnerWriteOff,
      PartnerWriteOffLine,
      PartnerOpeningBalance,
      PartnerOpeningBalanceLine,
      Customer,
      Supplier,
      SalesInvoice,
      PurchaseInvoice,
      Treasury,
      Cheque,
      Account,
    ]),
    AccountingModule,
    SalesModule,
    PurchasingModule,
  ],
  controllers: [
    PaymentsController,
    SalesWriteOffsController,
    PurchaseWriteOffsController,
    OpeningBalancesController,
  ],
  providers: [PaymentsService, WriteOffsService, OpeningBalancesService],
  exports: [PaymentsService, WriteOffsService, OpeningBalancesService],
})
export class PaymentsModule {}
