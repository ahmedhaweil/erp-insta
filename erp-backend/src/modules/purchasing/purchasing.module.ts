import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Supplier } from './entities/supplier.entity';
import { PurchaseOrder } from './entities/purchase-order.entity';
import { PurchaseOrderLine } from './entities/purchase-order-line.entity';
import { PurchaseInvoice } from './entities/purchase-invoice.entity';
import { PurchaseInvoiceLine } from './entities/purchase-invoice-line.entity';
import { Product } from '@modules/inventory/entities/product.entity';
import { Stock } from '@modules/inventory/entities/stock.entity';
import { PurchasingSettings } from './entities/purchasing-settings.entity';
import {
  PurchaseRequisition,
  PurchaseRequisitionLine,
} from './entities/purchase-requisition.entity';
import { PurchaseReturn, PurchaseReturnLine } from './entities/purchase-return.entity';
import { PurchasingSettingsService } from './services/purchasing-settings.service';
import { PurchaseRequisitionsService } from './services/purchase-requisitions.service';
import { PurchaseReturnsService } from './services/purchase-returns.service';
import {
  PurchaseRequisitionsController,
  PurchaseReturnsController,
  PurchasingSettingsController,
} from './controllers/purchasing-extensions.controller';
import { AuthModule } from '@modules/auth/auth.module';
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
import { ApprovalsModule } from '@modules/approvals/approvals.module';

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
      PurchasingSettings,
      PurchaseRequisition,
      PurchaseRequisitionLine,
      PurchaseReturn,
      PurchaseReturnLine,
    ]),
    AccountingModule,
    InventoryModule,
    AuthModule,
    ApprovalsModule,
  ],
  controllers: [
    SuppliersController,
    PurchaseOrdersController,
    PurchaseInvoicesController,
    ReplenishmentController,
    PurchasingSettingsController,
    PurchaseRequisitionsController,
    PurchaseReturnsController,
  ],
  providers: [
    SuppliersService,
    PurchaseOrdersService,
    PurchaseInvoicesService,
    ReplenishmentService,
    PurchasingSettingsService,
    PurchaseRequisitionsService,
    PurchaseReturnsService,
  ],
  exports: [
    SuppliersService,
    PurchaseOrdersService,
    PurchaseInvoicesService,
    PurchasingSettingsService,
    PurchaseReturnsService,
    PurchaseRequisitionsService,
  ],
})
export class PurchasingModule {}
