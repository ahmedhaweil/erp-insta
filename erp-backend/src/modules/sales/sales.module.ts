import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Customer } from './entities/customer.entity';
import { SalesOrder } from './entities/sales-order.entity';
import { SalesOrderLine } from './entities/sales-order-line.entity';
import { SalesInvoice } from './entities/sales-invoice.entity';
import { SalesInvoiceLine } from './entities/sales-invoice-line.entity';
import { CustomersService } from './services/customers.service';
import { SalesOrdersService } from './services/sales-orders.service';
import { SalesInvoicesService } from './services/sales-invoices.service';
import { CustomersController } from './controllers/customers.controller';
import { SalesOrdersController } from './controllers/sales-orders.controller';
import { SalesInvoicesController } from './controllers/sales-invoices.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Customer,
      SalesOrder,
      SalesOrderLine,
      SalesInvoice,
      SalesInvoiceLine,
    ]),
  ],
  controllers: [CustomersController, SalesOrdersController, SalesInvoicesController],
  providers: [CustomersService, SalesOrdersService, SalesInvoicesService],
  exports: [CustomersService, SalesOrdersService, SalesInvoicesService],
})
export class SalesModule {}
