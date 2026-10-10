import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from '@modules/inventory/entities/product.entity';
import { Notification } from '@modules/notifications/entities/notification.entity';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { ReportsModule } from '@modules/reports/reports.module';
import { AuthModule } from '@modules/auth/auth.module';
import { AnalyticsSettings } from './entities/analytics-settings.entity';
import { AnalyticsController } from './controllers/analytics.controller';
import { AnalyticsService } from './services/analytics.service';
import { AnalyticsSettingsService } from './services/analytics-settings.service';
import { AlertsService } from './services/alerts.service';
import { AlertsSchedulerService } from './services/alerts-scheduler.service';

/** Business analytics, insights and alerts (permission module `analytics`). */
@Module({
  imports: [
    TypeOrmModule.forFeature([AnalyticsSettings, Product, Notification]),
    ReportsModule,
    NotificationsModule,
    AuthModule,
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsSettingsService, AlertsService, AlertsSchedulerService],
  exports: [AnalyticsService, AlertsService],
})
export class AnalyticsModule {}
