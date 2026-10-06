import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from './entities/product.entity';
import { Category } from './entities/category.entity';
import { Unit } from './entities/unit.entity';
import { Warehouse } from './entities/warehouse.entity';
import { Stock } from './entities/stock.entity';
import { StockMovement } from './entities/stock-movement.entity';
import { ProductsService } from './services/products.service';
import { StockService } from './services/stock.service';
import { ProductsController } from './controllers/products.controller';
import { StockController } from './controllers/stock.controller';
import { MasterDataController } from './controllers/master-data.controller';
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
    ]),
    AccountingModule,
  ],
  controllers: [ProductsController, StockController, MasterDataController],
  providers: [ProductsService, StockService, MasterDataService],
  exports: [ProductsService, StockService],
})
export class InventoryModule {}
