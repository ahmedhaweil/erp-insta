import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, FindOptionsWhere, ILike, In, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { EInvoice, EInvoiceProvider, EInvoiceStatus } from '../entities/e-invoice.entity';
import { ComplianceCountry } from '../entities/compliance-settings.entity';
import { ComplianceSettingsService } from './compliance-settings.service';
import { EtaInvoiceService } from './eta-invoice.service';
import { ZatcaInvoiceService } from './zatca-invoice.service';
import { ListComplianceDocumentsDto, SubmitInvoiceDto } from '../dto/submit-invoice.dto';
import { decodeTlv } from '../zatca/zatca-tlv';

export function dateRange(from?: string, to?: string) {
  if (from && to) return Between(from, to);
  if (from) return MoreThanOrEqual(from);
  if (to) return LessThanOrEqual(to);
  return undefined;
}

/**
 * Entry point for electronic invoices: routes to ETA (Egypt) or ZATCA (Saudi
 * Arabia) according to the tenant's compliance country.
 */
@Injectable()
export class EInvoiceService {
  private readonly logger = new Logger(EInvoiceService.name);

  constructor(
    @InjectRepository(EInvoice)
    private readonly eInvoiceRepo: Repository<EInvoice>,
    private readonly settingsService: ComplianceSettingsService,
    private readonly eta: EtaInvoiceService,
    private readonly zatca: ZatcaInvoiceService,
  ) {}

  private async country(tenantId: string): Promise<ComplianceCountry> {
    return (await this.settingsService.find(tenantId)).country || ComplianceCountry.EG;
  }

  async submitInvoice(tenantId: string, dto: SubmitInvoiceDto, userId: string | null = null): Promise<EInvoice> {
    const country = await this.country(tenantId);
    return country === ComplianceCountry.SA
      ? this.zatca.submit(tenantId, userId, dto.invoiceId)
      : this.eta.submit(tenantId, userId, dto.invoiceId);
  }

  async preview(tenantId: string, invoiceId: string) {
    const country = await this.country(tenantId);
    return country === ComplianceCountry.SA
      ? { provider: EInvoiceProvider.ZATCA, ...(await this.zatca.preview(tenantId, invoiceId)) }
      : { provider: EInvoiceProvider.ETA, ...(await this.eta.preview(tenantId, invoiceId)) };
  }

  /**
   * Automatic submission hook, for the sales module to call after an invoice
   * is posted (no domain event exists for posting yet). Never throws: a
   * failure must not block posting; it stays visible in the e-invoice list.
   */
  async submitIfEnabled(tenantId: string, userId: string | null, invoiceId: string): Promise<EInvoice | null> {
    const settings = await this.settingsService.find(tenantId);
    if (!settings.isEnabled || !settings.autoSubmit) return null;
    try {
      return await this.submitInvoice(tenantId, { invoiceId }, userId);
    } catch (err) {
      this.logger.warn(`Automatic e-invoice submission of ${invoiceId} failed: ${(err as Error).message}`);
      return null;
    }
  }

  async getStatus(tenantId: string, id: string): Promise<EInvoice> {
    const invoice = await this.eInvoiceRepo.findOne({ where: { id, tenantId } });
    if (!invoice) throw new NotFoundException('E-Invoice not found');
    return invoice;
  }

  async findAll(tenantId: string, query: ListComplianceDocumentsDto = {}) {
    const page = query.page || 1;
    const limit = query.limit || 25;
    const base: FindOptionsWhere<EInvoice> = { tenantId };
    if (query.provider) base.provider = query.provider;
    if (query.status) base.status = query.status;
    const range = dateRange(query.from, query.to);
    if (range) base.documentDate = range as any;
    const where = query.search
      ? [
          { ...base, internalId: ILike(`%${query.search}%`) },
          { ...base, uuid: ILike(`%${query.search}%`) },
        ]
      : base;
    const [items, total] = await this.eInvoiceRepo.findAndCount({
      where,
      order: { createdAt: (query.order || 'desc').toUpperCase() as 'ASC' | 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true, invoiceId: true, provider: true, documentType: true, documentSubtype: true,
        internalId: true, documentDate: true, totalAmount: true, status: true, uuid: true,
        longId: true, submissionUuid: true, icv: true, attempts: true, lastError: true,
        submittedAt: true, validatedAt: true, cancelledAt: true, createdAt: true, updatedAt: true,
      },
    });
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async refreshStatus(tenantId: string, id: string): Promise<EInvoice> {
    const record = await this.getStatus(tenantId, id);
    if (record.provider === EInvoiceProvider.ZATCA) {
      // ZATCA answers synchronously; there is nothing to poll.
      return record;
    }
    return this.eta.refresh(tenantId, record);
  }

  /** Refreshes every ETA document still in "submitted" state (optionally for all tenants). */
  async refreshPending(tenantId?: string, limit = 50): Promise<{ checked: number; changed: number }> {
    const where: FindOptionsWhere<EInvoice> = {
      provider: EInvoiceProvider.ETA,
      status: In([EInvoiceStatus.SUBMITTED]),
    };
    if (tenantId) where.tenantId = tenantId;
    const pending = await this.eInvoiceRepo.find({ where, order: { lastCheckedAt: 'ASC' }, take: limit });
    let changed = 0;
    for (const record of pending) {
      const before = record.status;
      try {
        const after = await this.eta.refresh(record.tenantId, record);
        if (after.status !== before) changed++;
      } catch (err) {
        this.logger.warn(`Status refresh of ${record.id} failed: ${(err as Error).message}`);
      }
    }
    return { checked: pending.length, changed };
  }

  async cancel(tenantId: string, id: string, reason: string): Promise<EInvoice> {
    const record = await this.getStatus(tenantId, id);
    if (record.provider === EInvoiceProvider.ZATCA) {
      throw new BadRequestException(
        'ZATCA invoices cannot be cancelled: issue a credit note (381) against the invoice instead',
      );
    }
    return this.eta.cancel(tenantId, record, reason);
  }

  rejectReceived(tenantId: string, uuid: string, reason: string) {
    return this.eta.rejectReceived(tenantId, uuid, reason);
  }

  /** QR / print data of a document. */
  async getQr(tenantId: string, id: string) {
    const record = await this.getStatus(tenantId, id);
    if (record.provider === EInvoiceProvider.ZATCA) {
      let fields: { tag: number; value: string }[] = [];
      if (record.qrContent) {
        fields = decodeTlv(record.qrContent).map(({ tag, value }) => ({
          tag,
          // Tags 8/9 are binary; show them base64 encoded.
          value: tag >= 8 ? value.toString('base64') : value.toString('utf8'),
        }));
      }
      return {
        provider: record.provider,
        status: record.status,
        uuid: record.uuid,
        qrContent: record.qrContent,
        qrFields: fields,
      };
    }
    const settings = await this.settingsService.find(tenantId);
    const printUrl = this.eta.printUrl(settings, record);
    return {
      provider: record.provider,
      status: record.status,
      uuid: record.uuid,
      longId: record.longId,
      printUrl,
      qrContent: printUrl,
    };
  }
}
