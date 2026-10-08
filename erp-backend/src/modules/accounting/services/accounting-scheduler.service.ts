import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { runInTransaction } from 'typeorm-transactional';
import { RecurringEntriesService } from './recurring-entries.service';
import { DeferralsService } from './deferrals.service';
import { today } from '@shared/utils/document-totals.util';

/**
 * Optional in-process scheduler for recurring entries and deferral
 * recognitions. Off by default; set RECURRING_RUN_INTERVAL_SEC (e.g. 3600)
 * to run the due generation for every tenant at that interval. Each tenant
 * runs in its own transaction; generation is idempotent, so several
 * instances or a manual run at the same time never duplicate entries
 * (the unique run index rejects the loser).
 */
@Injectable()
export class AccountingSchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AccountingSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly recurring: RecurringEntriesService,
    private readonly deferrals: DeferralsService,
  ) {}

  onApplicationBootstrap(): void {
    const seconds = Number(process.env.RECURRING_RUN_INTERVAL_SEC || 0);
    if (!(seconds > 0)) return;
    this.logger.log(`Recurring entries / deferrals scheduler every ${seconds}s`);
    this.timer = setInterval(() => void this.tick(), seconds * 1000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(asOf: string = today()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const tenants = new Set([
        ...(await this.recurring.tenantsDue(asOf)),
        ...(await this.deferrals.tenantsDue(asOf)),
      ]);
      for (const tenantId of tenants) {
        try {
          await runInTransaction(async () => {
            const r = await this.recurring.runDue(tenantId, asOf);
            const d = await this.deferrals.runDue(tenantId, asOf);
            const generated = r.results.reduce((s, x) => s + x.generated.length, 0);
            const posted = d.schedules.reduce((s, x) => s + x.posted, 0);
            if (generated || posted) {
              this.logger.log(`Tenant ${tenantId}: ${generated} recurring entries, ${posted} deferral lines`);
            }
          });
        } catch (err) {
          this.logger.error(`Scheduled run failed for tenant ${tenantId}: ${(err as Error).message}`);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
