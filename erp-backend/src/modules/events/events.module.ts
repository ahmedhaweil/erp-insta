import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Stock } from '@modules/inventory/entities/stock.entity';
import { Product } from '@modules/inventory/entities/product.entity';
import { AccountingListener } from './listeners/accounting.listener';
import { InventoryListener } from './listeners/inventory.listener';
import { SalesListener } from './listeners/sales.listener';
import { NotificationsListener } from './listeners/notifications.listener';
import { NotificationsModule } from '@modules/notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Stock, Product]),
    NotificationsModule,
  ],
  providers: [
    AccountingListener,
    InventoryListener,
    SalesListener,
    NotificationsListener,
  ],
})
export class EventsModule {}
