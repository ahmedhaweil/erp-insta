import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { runInTransaction } from 'typeorm-transactional';
import { AlertsService } from './alerts.service';

/**
 * In-process alert scheduler, off by default. With ALERTS_SCAN_INTERVAL_SEC > 0
 * it scans every tenant having active rules, one tenant after the other, each
 * in its own transaction (a failing tenant does not stop the others).
 * Daily de-duplication makes frequent intervals safe. POST /alerts/scan does
 * the same for one tenant on demand (e.g. from an external cron).
 */
@Injectable()
export class AlertsSchedulerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(AlertsSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly alerts: AlertsService,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit() {
    const seconds = Number(process.env.ALERTS_SCAN_INTERVAL_SEC ?? 0) || 0;
    if (seconds <= 0) return;
    const interval = Math.max(seconds, 60);
    this.timer = setInterval(() => void this.tick(), interval * 1000);
    this.timer.unref?.();
    this.logger.log(`Scanning alert rules every ${interval}s`);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Scans all tenants sequentially; returns the number of tenants scanned successfully. */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let ok = 0;
    try {
      const tenants = await this.alerts.tenantsToScan();
      for (const tenantId of tenants) {
        try {
          await this.runForTenant(tenantId, async () => {
            await this.alerts.scan(tenantId);
          });
          ok++;
        } catch (err) {
          this.alerts.logFailure(tenantId, err);
        }
      }
    } catch (err) {
      this.logger.warn(`Alert scheduler failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
    return ok;
  }

  /** One transaction per tenant, with the tenant set for row-level security. */
  protected runForTenant(tenantId: string, fn: () => Promise<void>): Promise<void> {
    return runInTransaction(async () => {
      await this.dataSource.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
      await fn();
    });
  }
}
