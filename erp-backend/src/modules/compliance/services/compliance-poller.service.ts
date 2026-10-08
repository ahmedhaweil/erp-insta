import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EInvoiceService } from './e-invoice.service';

/**
 * Optional background job polling ETA for documents still "submitted".
 * Enabled with COMPLIANCE_POLL_INTERVAL_SEC > 0 (disabled by default; the
 * POST /compliance/e-invoices/refresh-pending endpoint does the same on demand
 * and can be called from an external scheduler instead).
 */
@Injectable()
export class CompliancePollerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(CompliancePollerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly eInvoices: EInvoiceService,
  ) {}

  onModuleInit() {
    const seconds = Number(this.config.get('compliance.pollIntervalSec')) || 0;
    if (seconds <= 0) return;
    this.timer = setInterval(() => void this.tick(), seconds * 1000);
    this.timer.unref?.();
    this.logger.log(`Polling ETA document statuses every ${seconds}s`);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const { checked, changed } = await this.eInvoices.refreshPending();
      if (checked) this.logger.log(`Checked ${checked} ETA documents, ${changed} changed`);
    } catch (err) {
      this.logger.warn(`ETA status polling failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
