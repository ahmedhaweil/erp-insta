import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Bom } from './entities/bom.entity';
import { BomLine } from './entities/bom-line.entity';
import { ProductionOrder } from './entities/production-order.entity';
import { ProductionOrderLine } from './entities/production-order-line.entity';
import { ProductionRecord } from './entities/production-record.entity';
import { Scrap } from './entities/scrap.entity';
import { Product } from '@modules/inventory/entities/product.entity';
import { Warehouse } from '@modules/inventory/entities/warehouse.entity';
import { BomsService } from './services/boms.service';
import { ProductionOrdersService } from './services/production-orders.service';
import { ManufacturingReportsService } from './services/manufacturing-reports.service';
import { BomsController } from './controllers/boms.controller';
import {
  ManufacturingController,
  ProductionOrdersController,
} from './controllers/production-orders.controller';
import { AccountingModule } from '@modules/accounting/accounting.module';
import { InventoryModule } from '@modules/inventory/inventory.module';

/** Manufacturing / industrial costing (التصنيع والمحاسبة الصناعية). */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Bom,
      BomLine,
      ProductionOrder,
      ProductionOrderLine,
      ProductionRecord,
      Scrap,
      Product,
      Warehouse,
    ]),
    AccountingModule,
    InventoryModule,
  ],
  controllers: [BomsController, ProductionOrdersController, ManufacturingController],
  providers: [BomsService, ProductionOrdersService, ManufacturingReportsService],
  exports: [BomsService, ProductionOrdersService],
})
export class ManufacturingModule {}
