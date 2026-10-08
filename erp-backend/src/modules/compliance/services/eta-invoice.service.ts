import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SalesInvoiceType } from '@modules/sales/entities/sales-invoice.entity';
import {
  EInvoice,
  EInvoiceProvider,
  EInvoiceStatus,
  EInvoiceType,
} from '../entities/e-invoice.entity';
import { ComplianceSettings } from '../entities/compliance-settings.entity';
import { ComplianceSettingsService } from './compliance-settings.service';
import { DocumentSourceService, inferReceiver, LoadedInvoice } from './document-source.service';
import { ItemCodesService } from './item-codes.service';
import { buildEtaDocument, etaDateTime, EtaLineInput } from '../eta/eta-document.builder';
import { etaSerializeForSigning } from '../eta/eta-serializer';
import { ExternalSignerService } from '../eta/external-signer.service';
import { EtaApiClient } from '../eta/eta-api.client';
import { EtaApiError } from '../eta/eta-errors';
import { extractEtaValidationErrors, flattenEtaError, mapEtaStatus } from '../eta/eta-status';
import { ComplianceTransportError } from '../http/compliance-http.client';

/** Statuses from which a document may be (re)submitted. */
export const RESUBMITTABLE = [EInvoiceStatus.PENDING, EInvoiceStatus.INVALID, EInvoiceStatus.FAILED];

@Injectable()
export class EtaInvoiceService {
  private readonly logger = new Logger(EtaInvoiceService.name);

  constructor(
    @InjectRepository(EInvoice)
    private readonly eInvoiceRepo: Repository<EInvoice>,
    private readonly settingsService: ComplianceSettingsService,
    private readonly source: DocumentSourceService,
    private readonly itemCodes: ItemCodesService,
    private readonly signer: ExternalSignerService,
    private readonly api: EtaApiClient,
  ) {}

  /** Builds the unsigned ETA document of a posted invoice / credit note. */
  async buildDocument(tenantId: string, settings: ComplianceSettings, loaded: LoadedInvoice) {
    const { invoice, customer, party, products } = loaded;
    const codes = await this.itemCodes.mapForProducts(tenantId, [...products.keys()]);

    const missing: string[] = [];
    const lines: EtaLineInput[] = (invoice.lines || []).map((line) => {
      const product = products.get(line.productId);
      const code = codes.get(line.productId);
      if (!code) missing.push(product?.code || line.productId);
      return {
        description: line.description || product?.nameEn || product?.nameAr || product?.code || 'Item',
        itemType: code?.itemType || 'EGS',
        itemCode: code?.itemCode || '',
        unitType:
          code?.unitType ||
          (product?.unitId && settings.unitTypeMap?.[product.unitId]) ||
          settings.defaultUnitType ||
          'EA',
        internalCode: product?.code || line.productId,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
        discount: Number(line.discount || 0),
        taxRate: Number(line.taxRate || 0),
        taxSubtype: code?.taxSubtype || (Number(line.taxRate) > 0 ? settings.defaultTaxSubtype || 'V009' : ''),
      };
    });
    if (missing.length) {
      throw new BadRequestException({
        message: 'ETA item codes are missing for some products',
        errors: missing.map((p) => `Product ${p} has no ETA item code mapping`),
      });
    }

    const isCreditNote = invoice.moveType === SalesInvoiceType.CREDIT_NOTE;
    let references: string[] | undefined;
    if (isCreditNote) {
      const original = invoice.reversedInvoiceId
        ? await this.eInvoiceRepo.findOne({
            where: { tenantId, invoiceId: invoice.reversedInvoiceId, provider: EInvoiceProvider.ETA },
          })
        : null;
      references = original?.uuid ? [original.uuid] : [];
    }

    const receiver = inferReceiver(customer, party);
    const posted = invoice.postedAt ? new Date(invoice.postedAt) : null;
    const issued =
      posted && posted.toISOString().slice(0, 10) === String(invoice.date) && posted.getTime() <= Date.now()
        ? posted
        : String(invoice.date);

    return buildEtaDocument({
      documentType: isCreditNote ? 'C' : 'I',
      version: settings.etaDocumentVersion || '1.0',
      dateTimeIssued: etaDateTime(issued),
      internalId: invoice.invoiceNumber,
      currencyCode: loaded.currencyCode || 'EGP',
      exchangeRate: loaded.currencyCode && loaded.currencyCode !== 'EGP' ? Number(invoice.exchangeRate) : 1,
      issuer: {
        rin: settings.taxpayerId,
        name: settings.taxpayerName,
        activityCode: settings.activityCode,
        address: {
          branchID: settings.branchCode || '0',
          country: 'EG', // ETA issuers are Egyptian taxpayers
          governate: settings.governate,
          regionCity: settings.regionCity,
          street: settings.street,
          buildingNumber: settings.buildingNumber,
          postalCode: settings.postalCode,
          floor: settings.floor,
          room: settings.room,
          landmark: settings.landmark,
          additionalInformation: settings.additionalInformation,
        },
      },
      receiver: {
        type: receiver.type,
        id: receiver.id,
        name: customer?.nameEn || customer?.nameAr || '',
        address: {
          country: receiver.countryCode,
          governate: receiver.governate,
          regionCity: receiver.regionCity,
          street: receiver.street,
          buildingNumber: receiver.buildingNumber,
          postalCode: receiver.postalCode,
        },
      },
      lines,
      references,
    });
  }

  /** Builds (and signs when version 1.0) the document without submitting it. */
  async preview(tenantId: string, invoiceId: string) {
    const settings = await this.settingsService.resolve(tenantId);
    const loaded = await this.source.loadInvoice(tenantId, invoiceId);
    const document = await this.buildDocument(tenantId, settings, loaded);
    return { document, serialized: etaSerializeForSigning(document) };
  }

  async submit(tenantId: string, userId: string | null, invoiceId: string): Promise<EInvoice> {
    const settings = await this.settingsService.resolve(tenantId);
    const loaded = await this.source.loadInvoice(tenantId, invoiceId);

    let record = await this.eInvoiceRepo.findOne({
      where: { tenantId, invoiceId, provider: EInvoiceProvider.ETA },
    });
    if (record && !RESUBMITTABLE.includes(record.status)) {
      throw new ConflictException(`Invoice already ${record.status} at ETA; refresh its status instead`);
    }

    const document = await this.buildDocument(tenantId, settings, loaded);
    if (document.documentTypeVersion === '1.0') {
      const signature = await this.signer.sign(etaSerializeForSigning(document), settings.etaSignerUrl);
      document.signatures = [{ signatureType: 'I', value: signature }];
    }

    record =
      record ||
      this.eInvoiceRepo.create({
        tenantId,
        invoiceId,
        invoiceType: EInvoiceType.SALES,
        provider: EInvoiceProvider.ETA,
      });
    Object.assign(record, {
      documentType: document.documentType,
      internalId: document.internalID,
      documentDate: loaded.invoice.date,
      totalAmount: document.totalAmount,
      payload: document,
      validationErrors: null,
      lastError: null,
      attempts: (record.attempts || 0) + 1,
      submittedBy: userId,
    });

    const conn = this.settingsService.etaConnection(settings);
    try {
      const res = await this.api.submitDocuments(conn, [document]);
      record.submissionUuid = res.submissionId;
      record.submittedAt = new Date();
      record.response = res as any;
      const accepted = (res.acceptedDocuments || []).find((d) => d.internalId === document.internalID) ||
        res.acceptedDocuments?.[0];
      const rejected = (res.rejectedDocuments || []).find((d) => d.internalId === document.internalID) ||
        res.rejectedDocuments?.[0];
      if (accepted) {
        record.status = EInvoiceStatus.SUBMITTED;
        record.uuid = accepted.uuid;
        record.longId = accepted.longId || record.longId;
        record.invoiceHash = accepted.hashKey || record.invoiceHash;
      } else {
        record.status = EInvoiceStatus.INVALID;
        record.validationErrors = flattenEtaError(rejected?.error);
      }
    } catch (err) {
      this.applyError(record, err);
    }
    return this.eInvoiceRepo.save(record);
  }

  /** Polls ETA for the document status (details endpoint). */
  async refresh(tenantId: string, record: EInvoice): Promise<EInvoice> {
    const settings = await this.settingsService.resolve(tenantId);
    const conn = this.settingsService.etaConnection(settings);
    record.lastCheckedAt = new Date();
    try {
      if (!record.uuid && record.submissionUuid) {
        const submission = await this.api.getSubmission(conn, record.submissionUuid);
        const summary = (submission?.documentSummary || []).find(
          (d: any) => d.internalId === record.internalId,
        );
        if (summary) {
          record.uuid = summary.uuid;
          record.longId = summary.longId || record.longId;
        }
      }
      if (!record.uuid) return this.eInvoiceRepo.save(record);

      const details = await this.api.getDocumentDetails(conn, record.uuid);
      const status = mapEtaStatus(details?.status);
      record.status = status;
      record.longId = details?.longId || record.longId;
      record.response = { ...(details || {}), document: undefined };
      if (status === EInvoiceStatus.INVALID) {
        record.validationErrors = extractEtaValidationErrors(details);
      } else if (status === EInvoiceStatus.VALID) {
        record.validationErrors = null as any;
        record.validatedAt = details?.dateTimeValidated ? new Date(details.dateTimeValidated) : new Date();
      } else if (status === EInvoiceStatus.CANCELLED && !record.cancelledAt) {
        record.cancelledAt = new Date();
      }
      if (record.uuid && record.longId) {
        record.qrContent = EtaApiClient.printUrl(conn.portalUrl, record.uuid, record.longId);
      }
      record.lastError = null as any;
    } catch (err) {
      if (err instanceof EtaApiError || err instanceof ComplianceTransportError) {
        record.lastError = err.message;
        this.logger.warn(`ETA status refresh failed for ${record.internalId}: ${err.message}`);
      } else {
        throw err;
      }
    }
    return this.eInvoiceRepo.save(record);
  }

  async cancel(tenantId: string, record: EInvoice, reason: string): Promise<EInvoice> {
    if (record.status !== EInvoiceStatus.VALID || !record.uuid) {
      throw new ConflictException('Only valid ETA documents can be cancelled');
    }
    const settings = await this.settingsService.resolve(tenantId);
    const conn = this.settingsService.etaConnection(settings);
    try {
      await this.api.cancelDocument(conn, record.uuid, reason);
    } catch (err) {
      if (err instanceof EtaApiError) {
        throw new BadRequestException({ message: err.message, errors: flattenEtaError(err.data?.error) });
      }
      throw err;
    }
    record.status = EInvoiceStatus.CANCELLED;
    record.cancelledAt = new Date();
    record.cancelReason = reason;
    return this.eInvoiceRepo.save(record);
  }

  /** Rejects a document issued TO this taxpayer by a supplier. */
  async rejectReceived(tenantId: string, uuid: string, reason: string) {
    const settings = await this.settingsService.resolve(tenantId);
    const conn = this.settingsService.etaConnection(settings);
    try {
      await this.api.rejectDocument(conn, uuid, reason);
    } catch (err) {
      if (err instanceof EtaApiError) {
        throw new BadRequestException({ message: err.message, errors: flattenEtaError(err.data?.error) });
      }
      throw err;
    }
    return { uuid, status: EInvoiceStatus.REJECTED, reason };
  }

  printUrl(settings: ComplianceSettings, record: EInvoice): string | null {
    if (!record.uuid || !record.longId) return null;
    return EtaApiClient.printUrl(this.settingsService.etaUrls(settings).portal, record.uuid, record.longId);
  }

  private applyError(record: EInvoice, err: unknown) {
    if (err instanceof EtaApiError) {
      record.response = err.data;
      record.lastError = err.message;
      if (err.isClientError) {
        record.status = EInvoiceStatus.INVALID;
        record.validationErrors = flattenEtaError(err.data?.error || err.data);
      } else {
        record.status = EInvoiceStatus.FAILED;
      }
      return;
    }
    if (err instanceof ComplianceTransportError) {
      record.status = EInvoiceStatus.FAILED;
      record.lastError = err.message;
      return;
    }
    throw err;
  }
}
