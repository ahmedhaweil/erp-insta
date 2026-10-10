import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FuelNozzle, FuelPump, FuelTank } from './entities/fuel-setup.entity';
import { FuelShift, FuelShiftCredit, FuelShiftLine } from './entities/fuel-shift.entity';
import { FuelMeterAdjustment, FuelTankDip } from './entities/fuel-control.entity';
import { Product } from '@modules/inventory/entities/product.entity';
import { StockMovement } from '@modules/inventory/entities/stock-movement.entity';
import { FuelService } from './services/fuel.service';
import { FuelController } from './controllers/fuel.controller';
import { AuthModule } from '@modules/auth/auth.module';
import { AccountingModule } from '@modules/accounting/accounting.module';
import { InventoryModule } from '@modules/inventory/inventory.module';
import { SalesModule } from '@modules/sales/sales.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FuelTank,
      FuelPump,
      FuelNozzle,
      FuelShift,
      FuelShiftLine,
      FuelShiftCredit,
      FuelTankDip,
      FuelMeterAdjustment,
      Product,
      StockMovement,
    ]),
    AuthModule,
    AccountingModule,
    InventoryModule,
    SalesModule,
  ],
  controllers: [FuelController],
  providers: [FuelService],
  exports: [FuelService],
})
export class FuelModule {}
