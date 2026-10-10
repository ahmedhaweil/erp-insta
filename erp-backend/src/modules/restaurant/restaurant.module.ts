import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  DeliveryApp,
  DeliveryAppPrice,
  DeliveryZone,
  DiningArea,
  Driver,
  RestaurantTable,
} from './entities/master-data.entity';
import { ComboGroup, KitchenRoute, KitchenStation, ProductModifier } from './entities/menu.entity';
import { RestaurantSettings } from './entities/restaurant-settings.entity';
import {
  KitchenTicket,
  RestaurantTicket,
  RestaurantTicketLine,
  RestaurantVoidLog,
} from './entities/ticket.entity';
import { Product } from '@modules/inventory/entities/product.entity';
import { Customer } from '@modules/sales/entities/customer.entity';
import { PosSession } from '@modules/pos/entities/pos-session.entity';
import { AuthModule } from '@modules/auth/auth.module';
import { PosModule } from '@modules/pos/pos.module';
import { RealtimeModule } from '@modules/realtime/realtime.module';
import { RestaurantMasterService } from './services/restaurant-master.service';
import { TicketsService } from './services/tickets.service';
import { KitchenService } from './services/kitchen.service';
import { RestaurantReportsService } from './services/restaurant-reports.service';
import { RestaurantMasterController } from './controllers/restaurant-master.controller';
import { TicketsController } from './controllers/tickets.controller';
import { KitchenController, RestaurantReportsController } from './controllers/kitchen-reports.controller';

/**
 * Restaurant: tables, open tickets (dine-in, takeaway, pickup, delivery),
 * modifiers and combos, kitchen stations and KDS, drivers and delivery apps.
 * Tickets are settled through the POS (PosService.createOrder).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      DiningArea,
      RestaurantTable,
      DeliveryZone,
      Driver,
      DeliveryApp,
      DeliveryAppPrice,
      KitchenStation,
      KitchenRoute,
      ProductModifier,
      ComboGroup,
      RestaurantSettings,
      RestaurantTicket,
      RestaurantTicketLine,
      KitchenTicket,
      RestaurantVoidLog,
      Product,
      Customer,
      PosSession,
    ]),
    AuthModule,
    PosModule,
    RealtimeModule,
  ],
  controllers: [
    RestaurantMasterController,
    TicketsController,
    KitchenController,
    RestaurantReportsController,
  ],
  providers: [RestaurantMasterService, TicketsService, KitchenService, RestaurantReportsService],
  exports: [TicketsService],
})
export class RestaurantModule {}
