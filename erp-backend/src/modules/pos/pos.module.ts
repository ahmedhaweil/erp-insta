import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PosTerminal } from './entities/pos-terminal.entity';
import { PosSession } from './entities/pos-session.entity';
import { PosOrder } from './entities/pos-order.entity';
import { PosOrderLine } from './entities/pos-order-line.entity';
import { PosService } from './services/pos.service';
import { PosController } from './controllers/pos.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PosTerminal,
      PosSession,
      PosOrder,
      PosOrderLine,
    ]),
  ],
  controllers: [PosController],
  providers: [PosService],
  exports: [PosService],
})
export class PosModule {}
