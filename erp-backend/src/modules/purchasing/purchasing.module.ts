import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Supplier } from './entities/supplier.entity';
import { PurchaseOrder } from './entities/purchase-order.entity';
import { PurchaseOrderLine } from './entities/purchase-order-line.entity';
import { PurchaseInvoice } from './entities/purchase-invoice.entity';
import { PurchaseInvoiceLine } from './entities/purchase-invoice-line.entity';
import { SuppliersService } from './services/suppliers.service';
import { PurchaseOrdersService } from './services/purchase-orders.service';
import { PurchaseInvoicesService } from './services/purchase-invoices.service';
import { SuppliersController } from './controllers/suppliers.controller';
import { PurchaseOrdersController } from './controllers/purchase-orders.controller';
import { PurchaseInvoicesController } from './controllers/purchase-invoices.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Supplier,
      PurchaseOrder,
      PurchaseOrderLine,
      PurchaseInvoice,
      PurchaseInvoiceLine,
    ]),
  ],
  controllers: [
    SuppliersController,
    PurchaseOrdersController,
    PurchaseInvoicesController,
  ],
  providers: [
    SuppliersService,
    PurchaseOrdersService,
    PurchaseInvoicesService,
  ],
  exports: [
    SuppliersService,
    PurchaseOrdersService,
    PurchaseInvoicesService,
  ],
})
export class PurchasingModule {}
