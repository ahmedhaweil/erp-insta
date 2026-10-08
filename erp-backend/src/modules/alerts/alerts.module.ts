import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { AlertDelivery, AlertRule } from './entities/alert-rule.entity';
import { AlertsService } from './services/alerts.service';
import { AlertSourcesService } from './services/alert-sources.service';
import { AlertsSchedulerService } from './services/alerts-scheduler.service';
import { AlertsController } from './controllers/alerts.controller';

/**
 * Configurable per-tenant alerts (cheques, overdue receivables, bills due,
 * expiring lots, low stock, payroll, period lock, e-invoices, POS sessions)
 * delivered as in-app notifications, on demand or by an optional scheduler.
 */
@Module({
  imports: [TypeOrmModule.forFeature([AlertRule, AlertDelivery]), NotificationsModule],
  controllers: [AlertsController],
  providers: [AlertsService, AlertSourcesService, AlertsSchedulerService],
  exports: [AlertsService],
})
export class AlertsModule {}
