import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { BullModule } from '@nestjs/bullmq';
import { configuration, configValidationSchema } from './config';
import { DatabaseModule } from './database/database.module';
import { SharedModule } from './shared/shared.module';
import { AuthModule } from './modules/auth/auth.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { AccountingModule } from './modules/accounting/accounting.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { SalesModule } from './modules/sales/sales.module';
import { PurchasingModule } from './modules/purchasing/purchasing.module';
import { PosModule } from './modules/pos/pos.module';
import { ComplianceModule } from './modules/compliance/compliance.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { EventsModule } from './modules/events/events.module';
import { ReportsModule } from './modules/reports/reports.module';

function buildImports() {
  const imports: any[] = [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: configValidationSchema,
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
    }),

    // Event Emitter for domain events
    EventEmitterModule.forRoot({
      wildcard: true,
      delimiter: '.',
      maxListeners: 20,
    }),

    // Database
    DatabaseModule,

    // Shared services
    SharedModule,

    // Business modules
    AuthModule,
    TenantsModule,
    AccountingModule,
    InventoryModule,
    SalesModule,
    PurchasingModule,
    PosModule,
    ComplianceModule,
    NotificationsModule,
    RealtimeModule,
    EventsModule,
    ReportsModule,
  ];

  // BullMQ for background jobs – only when Redis is available
  if (process.env.REDIS_HOST && process.env.REDIS_HOST !== 'disabled') {
    imports.splice(2, 0,
      BullModule.forRootAsync({
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          connection: {
            host: config.get('redis.host'),
            port: config.get('redis.port'),
            password: config.get('redis.password'),
          },
        }),
      }),
    );
  }

  return imports;
}

@Module({
  imports: buildImports(),
})
export class AppModule {}
