import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EInvoiceService } from './e-invoice.service';
import { EReceiptService } from './e-receipt.service';
import { ComplianceSettingsService } from './compliance-settings.service';
import { ComplianceCountry } from '../entities/compliance-settings.entity';

/**
 * Submits documents to the tax authority as soon as they are posted, for
 * tenants that enabled compliance with automatic submission. The events are
 * delivered after the posting transaction commits; a failed submission is
 * logged and left for manual resubmission, never undoing the posting.
 */
@Injectable()
export class ComplianceAutoSubmitListener {
  private readonly logger = new Logger(ComplianceAutoSubmitListener.name);

  constructor(
    private readonly eInvoices: EInvoiceService,
    private readonly eReceipts: EReceiptService,
    private readonly settings: ComplianceSettingsService,
  ) {}

  @OnEvent('sales_invoice.posted')
  async onInvoicePosted(event: { tenantId: string; userId: string; invoiceId: string }) {
    await this.eInvoices.submitIfEnabled(event.tenantId, event.userId, event.invoiceId);
  }

  /** ETA e-receipts are Egyptian; Saudi POS sales are reported as simplified invoices. */
  @OnEvent('pos_order.completed')
  async onPosOrder(event: { tenantId: string; posOrderId: string }) {
    try {
      const settings = await this.settings.find(event.tenantId);
      if (!settings.isEnabled || !settings.autoSubmit || settings.country !== ComplianceCountry.EG) {
        return;
      }
      await this.eReceipts.submit(event.tenantId, event.posOrderId);
    } catch (err) {
      this.logger.warn(
        `Automatic e-receipt submission of POS order ${event.posOrderId} failed: ${(err as Error).message}`,
      );
    }
  }
}
