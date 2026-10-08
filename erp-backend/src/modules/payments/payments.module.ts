import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from './entities/payment.entity';
import { PaymentAllocation } from './entities/payment-allocation.entity';
import { Customer } from '@modules/sales/entities/customer.entity';
import { Supplier } from '@modules/purchasing/entities/supplier.entity';
import { SalesInvoice } from '@modules/sales/entities/sales-invoice.entity';
import { PurchaseInvoice } from '@modules/purchasing/entities/purchase-invoice.entity';
import { Treasury } from '@modules/treasury/entities/treasury.entity';
import { Cheque } from '@modules/treasury/entities/cheque.entity';
import { PaymentsService } from './services/payments.service';
import { PaymentsController } from './controllers/payments.controller';
import { AccountingModule } from '@modules/accounting/accounting.module';
import { SalesModule } from '@modules/sales/sales.module';
import { PurchasingModule } from '@modules/purchasing/purchasing.module';
import { ApprovalsModule } from '@modules/approvals/approvals.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Payment,
      PaymentAllocation,
      Customer,
      Supplier,
      SalesInvoice,
      PurchaseInvoice,
      Treasury,
      Cheque,
    ]),
    AccountingModule,
    SalesModule,
    PurchasingModule,
    ApprovalsModule,
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
