import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PosTerminal } from './entities/pos-terminal.entity';
import { PosSession } from './entities/pos-session.entity';
import { PosOrder } from './entities/pos-order.entity';
import { PosOrderLine } from './entities/pos-order-line.entity';
import { PosCashMovement } from './entities/pos-cash-movement.entity';
import { Product } from '@modules/inventory/entities/product.entity';
import { Customer } from '@modules/sales/entities/customer.entity';
import { AuthModule } from '@modules/auth/auth.module';
import { PosService } from './services/pos.service';
import { PosController } from './controllers/pos.controller';
import { AccountingModule } from '@modules/accounting/accounting.module';
import { InventoryModule } from '@modules/inventory/inventory.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PosTerminal,
      PosSession,
      PosOrder,
      PosOrderLine,
      PosCashMovement,
      Product,
      Customer,
    ]),
    AuthModule,
    AccountingModule,
    InventoryModule,
  ],
  controllers: [PosController],
  providers: [PosService],
  exports: [PosService],
})
export class PosModule {}
