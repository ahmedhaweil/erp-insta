import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  MaintenanceTicket,
  MaintenanceTicketHistory,
  MaintenanceTicketLabour,
  MaintenanceTicketPart,
} from './entities/maintenance-ticket.entity';
import { Technician } from './entities/technician.entity';
import { MaintenanceSettings } from './entities/maintenance-settings.entity';
import { Product } from '@modules/inventory/entities/product.entity';
import { MaintenanceService } from './services/maintenance.service';
import { MaintenanceController } from './controllers/maintenance.controller';
import { AuthModule } from '@modules/auth/auth.module';
import { AccountingModule } from '@modules/accounting/accounting.module';
import { InventoryModule } from '@modules/inventory/inventory.module';
import { SalesModule } from '@modules/sales/sales.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      MaintenanceTicket,
      MaintenanceTicketPart,
      MaintenanceTicketLabour,
      MaintenanceTicketHistory,
      Technician,
      MaintenanceSettings,
      Product,
    ]),
    AuthModule,
    AccountingModule,
    InventoryModule,
    SalesModule,
  ],
  controllers: [MaintenanceController],
  providers: [MaintenanceService],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
