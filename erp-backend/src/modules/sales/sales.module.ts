import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Customer } from './entities/customer.entity';
import { CustomerCategory } from './entities/customer-category.entity';
import { CustomerAddress } from './entities/customer-address.entity';
import { SalesOrder } from './entities/sales-order.entity';
import { SalesOrderLine } from './entities/sales-order-line.entity';
import { SalesInvoice } from './entities/sales-invoice.entity';
import { SalesInvoiceLine } from './entities/sales-invoice-line.entity';
import { PriceList } from './entities/price-list.entity';
import { PriceListRule } from './entities/price-list-rule.entity';
import { SalesRep } from './entities/sales-rep.entity';
import { CommissionRule } from './entities/commission-rule.entity';
import { CommissionStatement } from './entities/commission-statement.entity';
import { SalesReturn, SalesReturnLine } from './entities/sales-return.entity';
import { Installment, InstallmentPlan } from './entities/installment-plan.entity';
import { Product } from '@modules/inventory/entities/product.entity';
import { Category } from '@modules/inventory/entities/category.entity';
import { StockMovement } from '@modules/inventory/entities/stock-movement.entity';
import { CustomersService } from './services/customers.service';
import { SalesOrdersService } from './services/sales-orders.service';
import { SalesInvoicesService } from './services/sales-invoices.service';
import { SalesPricingService } from './services/sales-pricing.service';
import { PriceListsService } from './services/price-lists.service';
import { CommissionsService } from './services/commissions.service';
import { SalesReturnsService } from './services/sales-returns.service';
import { InstallmentScheduleService } from './services/installment-schedule.service';
import { InstallmentPlansService } from './services/installment-plans.service';
import { CustomerCreditService } from './services/customer-credit.service';
import { CustomersController } from './controllers/customers.controller';
import { SalesOrdersController } from './controllers/sales-orders.controller';
import { SalesInvoicesController } from './controllers/sales-invoices.controller';
import {
  CustomerCategoriesController,
  PriceListsController,
  PricingController,
} from './controllers/price-lists.controller';
import {
  CommissionRulesController,
  CommissionStatementsController,
  SalesRepsController,
} from './controllers/commissions.controller';
import { SalesReturnsController } from './controllers/sales-returns.controller';
import { InstallmentPlansController } from './controllers/installment-plans.controller';
import { AccountingModule } from '@modules/accounting/accounting.module';
import { InventoryModule } from '@modules/inventory/inventory.module';
import { AuthModule } from '@modules/auth/auth.module';
import { PromotionsModule } from '@modules/promotions/promotions.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Customer,
      CustomerCategory,
      CustomerAddress,
      SalesOrder,
      SalesOrderLine,
      SalesInvoice,
      SalesInvoiceLine,
      PriceList,
      PriceListRule,
      SalesRep,
      CommissionRule,
      CommissionStatement,
      SalesReturn,
      SalesReturnLine,
      InstallmentPlan,
      Installment,
      Product,
      Category,
      StockMovement,
    ]),
    AccountingModule,
    InventoryModule,
    AuthModule,
    PromotionsModule,
  ],
  controllers: [
    CustomersController,
    SalesOrdersController,
    SalesInvoicesController,
    PriceListsController,
    PricingController,
    CustomerCategoriesController,
    SalesRepsController,
    CommissionRulesController,
    CommissionStatementsController,
    SalesReturnsController,
    InstallmentPlansController,
  ],
  providers: [
    CustomersService,
    SalesOrdersService,
    SalesInvoicesService,
    SalesPricingService,
    PriceListsService,
    CommissionsService,
    SalesReturnsService,
    InstallmentScheduleService,
    InstallmentPlansService,
    CustomerCreditService,
  ],
  exports: [
    CustomersService,
    SalesOrdersService,
    SalesInvoicesService,
    SalesPricingService,
    SalesReturnsService,
    InstallmentPlansService,
    CommissionsService,
    CustomerCreditService,
  ],
})
export class SalesModule {}
