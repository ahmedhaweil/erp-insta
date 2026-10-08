import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from './entities/product.entity';
import { Category } from './entities/category.entity';
import { Unit } from './entities/unit.entity';
import { Warehouse } from './entities/warehouse.entity';
import { Stock } from './entities/stock.entity';
import { StockMovement } from './entities/stock-movement.entity';
import { StockLot } from './entities/stock-lot.entity';
import { StockLotMovement } from './entities/stock-lot-movement.entity';
import { ProductUnit } from './entities/product-unit.entity';
import { StockTransfer, StockTransferLine } from './entities/stock-transfer.entity';
import { StockCount, StockCountLine } from './entities/stock-count.entity';
import { Tenant } from '@modules/tenants/entities/tenant.entity';
import { ProductsService } from './services/products.service';
import { StockService } from './services/stock.service';
import { LotsService } from './services/lots.service';
import { InventorySettingsService } from './services/inventory-settings.service';
import { StockTransfersService } from './services/stock-transfers.service';
import { StockCountsService } from './services/stock-counts.service';
import { InventoryReportsService } from './services/inventory-reports.service';
import { ProductsController } from './controllers/products.controller';
import { StockController } from './controllers/stock.controller';
import { MasterDataController } from './controllers/master-data.controller';
import { StockTransfersController } from './controllers/stock-transfers.controller';
import { StockCountsController } from './controllers/stock-counts.controller';
import { InventoryReportsController } from './controllers/inventory-reports.controller';
import { MasterDataService } from './services/master-data.service';
import { AccountingModule } from '@modules/accounting/accounting.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Product,
      Category,
      Unit,
      Warehouse,
      Stock,
      StockMovement,
      StockLot,
      StockLotMovement,
      ProductUnit,
      StockTransfer,
      StockTransferLine,
      StockCount,
      StockCountLine,
      Tenant,
    ]),
    AccountingModule,
  ],
  controllers: [
    ProductsController,
    StockController,
    MasterDataController,
    StockTransfersController,
    StockCountsController,
    InventoryReportsController,
  ],
  providers: [
    ProductsService,
    StockService,
    MasterDataService,
    LotsService,
    InventorySettingsService,
    StockTransfersService,
    StockCountsService,
    InventoryReportsService,
  ],
  exports: [ProductsService, StockService, LotsService, InventorySettingsService],
})
export class InventoryModule {}
