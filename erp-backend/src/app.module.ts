import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RbacGuard } from './common/guards/rbac.guard';
import { TenantGuard } from './common/guards/tenant.guard';
import { TransactionInterceptor } from './common/interceptors/transaction.interceptor';
import { HealthController } from './health.controller';
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
import { PaymentsModule } from './modules/payments/payments.module';
import { ManufacturingModule } from './modules/manufacturing/manufacturing.module';
import { CrmModule } from './modules/crm/crm.module';

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
    PaymentsModule,
    ComplianceModule,
    NotificationsModule,
    RealtimeModule,
    EventsModule,
    ReportsModule,
    ManufacturingModule,
    CrmModule,
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
  controllers: [HealthController],
  providers: [
    // Authenticate every route except those marked @Public(), reject users of
    // suspended tenants, then enforce @RequirePermissions. Guards run in
    // registration order.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
    // One database transaction per request.
    { provide: APP_INTERCEPTOR, useClass: TransactionInterceptor },
  ],
})
export class AppModule {}
