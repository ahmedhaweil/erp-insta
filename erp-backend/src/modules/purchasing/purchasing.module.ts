import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Supplier } from './entities/supplier.entity';
import { PurchaseOrder } from './entities/purchase-order.entity';
import { PurchaseOrderLine } from './entities/purchase-order-line.entity';
import { PurchaseInvoice } from './entities/purchase-invoice.entity';
import { PurchaseInvoiceLine } from './entities/purchase-invoice-line.entity';
import { Product } from '@modules/inventory/entities/product.entity';
import { Stock } from '@modules/inventory/entities/stock.entity';
import { SuppliersService } from './services/suppliers.service';
import { PurchaseOrdersService } from './services/purchase-orders.service';
import { PurchaseInvoicesService } from './services/purchase-invoices.service';
import { ReplenishmentService } from './services/replenishment.service';
import { SuppliersController } from './controllers/suppliers.controller';
import { PurchaseOrdersController } from './controllers/purchase-orders.controller';
import { PurchaseInvoicesController } from './controllers/purchase-invoices.controller';
import { ReplenishmentController } from './controllers/replenishment.controller';
import { AccountingModule } from '@modules/accounting/accounting.module';
import { InventoryModule } from '@modules/inventory/inventory.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Supplier,
      PurchaseOrder,
      PurchaseOrderLine,
      PurchaseInvoice,
      PurchaseInvoiceLine,
      Product,
      Stock,
    ]),
    AccountingModule,
    InventoryModule,
  ],
  controllers: [
    SuppliersController,
    PurchaseOrdersController,
    PurchaseInvoicesController,
    ReplenishmentController,
  ],
  providers: [
    SuppliersService,
    PurchaseOrdersService,
    PurchaseInvoicesService,
    ReplenishmentService,
  ],
  exports: [
    SuppliersService,
    PurchaseOrdersService,
    PurchaseInvoicesService,
  ],
})
export class PurchasingModule {}
