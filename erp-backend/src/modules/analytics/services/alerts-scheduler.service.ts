import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { runInTransaction } from 'typeorm-transactional';
import { AlertsService } from './alerts.service';

/**
 * Optional background job creating the alert notifications of tenants with
 * `autoNotify` on, same pattern as the compliance poller. Enabled with
 * ANALYTICS_ALERTS_INTERVAL_SEC > 0 (disabled by default). Notifications are
 * de-duplicated per day, so any interval yields at most one per alert a day;
 * POST /analytics/alerts/run does the same on demand.
 */
@Injectable()
export class AlertsSchedulerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(AlertsSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
    private readonly alerts: AlertsService,
  ) {}

  onModuleInit() {
    const seconds = Number(this.config.get('ANALYTICS_ALERTS_INTERVAL_SEC')) || 0;
    if (seconds <= 0) return;
    this.timer = setInterval(() => void this.tick(), seconds * 1000);
    this.timer.unref?.();
    this.logger.log(`Evaluating analytics alerts every ${seconds}s`);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const tenants: { tenantId: string }[] = await this.dataSource.query(
        `SELECT s.tenant_id AS "tenantId" FROM analytics_settings s
           JOIN tenants t ON t.id = s.tenant_id
          WHERE s.auto_notify = true AND t.is_active = true`,
      );
      for (const { tenantId } of tenants) {
        try {
          const res = await runInTransaction(async () => {
            await this.dataSource.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
            return this.alerts.run(tenantId);
          });
          if (res.created) this.logger.log(`Tenant ${tenantId}: ${res.created} alert notifications`);
        } catch (err) {
          this.logger.warn(`Alerts for tenant ${tenantId} failed: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      this.logger.warn(`Analytics alerts job failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
