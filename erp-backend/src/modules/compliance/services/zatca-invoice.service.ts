import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { SalesInvoiceType } from '@modules/sales/entities/sales-invoice.entity';
import {
  EInvoice,
  EInvoiceProvider,
  EInvoiceStatus,
  EInvoiceType,
} from '../entities/e-invoice.entity';
import { ComplianceSettings } from '../entities/compliance-settings.entity';
import { ComplianceSettingsService } from './compliance-settings.service';
import { ComplianceChainService } from './compliance-chain.service';
import { DocumentSourceService, inferReceiver, LoadedInvoice } from './document-source.service';
import {
  buildZatcaInvoice,
  extractQrFromXml,
  ZatcaInvoiceInput,
  ZatcaInvoiceKind,
} from '../zatca/zatca-xml.builder';
import { loadPrivateKey, parseCertificate, ZATCA_INITIAL_PIH } from '../zatca/zatca-crypto';
import { ZatcaApiClient } from '../zatca/zatca-api.client';
import { ComplianceTransportError } from '../http/compliance-http.client';
import { RESUBMITTABLE } from './eta-invoice.service';

export const ZATCA_CHAIN = 'zatca';

/** Riyadh is UTC+3 all year (no DST). */
function riyadhTime(date: Date): string {
  return new Date(date.getTime() + 3 * 3600 * 1000).toISOString().slice(11, 19);
}

@Injectable()
export class ZatcaInvoiceService {
  private readonly logger = new Logger(ZatcaInvoiceService.name);

  constructor(
    @InjectRepository(EInvoice)
    private readonly eInvoiceRepo: Repository<EInvoice>,
    private readonly settingsService: ComplianceSettingsService,
    private readonly chains: ComplianceChainService,
    private readonly source: DocumentSourceService,
    private readonly api: ZatcaApiClient,
  ) {}

  /** Maps a posted sales invoice to the ZATCA invoice input. */
  async buildInput(
    tenantId: string,
    settings: ComplianceSettings,
    loaded: LoadedInvoice,
    chain: { icv: number; pih: string; uuid: string },
  ): Promise<ZatcaInvoiceInput> {
    const { invoice, customer, party, products } = loaded;
    const receiver = inferReceiver(customer, party);
    const buyerVat = /^3\d{13}3$/.test(receiver.id || '') ? receiver.id : undefined;
    const kind =
      buyerVat || !settings.zatcaSimplifiedDefault ? ZatcaInvoiceKind.STANDARD : ZatcaInvoiceKind.SIMPLIFIED;
    // Amounts are reported in SAR: foreign-currency documents are converted.
    const rate = loaded.currencyCode && loaded.currencyCode !== 'SAR' ? Number(invoice.exchangeRate) || 1 : 1;

    const isCreditNote = invoice.moveType === SalesInvoiceType.CREDIT_NOTE;
    let billingReference: string | undefined;
    if (isCreditNote) {
      const original = invoice.reversedInvoiceId
        ? await this.source.findInvoice(tenantId, invoice.reversedInvoiceId)
        : null;
      billingReference = original?.invoiceNumber;
    }

    return {
      invoiceNumber: invoice.invoiceNumber,
      uuid: chain.uuid,
      issueDate: String(invoice.date),
      issueTime: invoice.postedAt ? riyadhTime(new Date(invoice.postedAt)) : '00:00:00',
      typeCode: isCreditNote ? '381' : '388',
      kind,
      currency: 'SAR',
      icv: chain.icv,
      pih: chain.pih,
      billingReference,
      instructionNote: isCreditNote ? invoice.notes || 'Returned goods' : undefined,
      paymentMeansCode: '10',
      seller: {
        name: settings.taxpayerName,
        vatNumber: settings.taxpayerId,
        idScheme: settings.commercialRegistration ? 'CRN' : undefined,
        id: settings.commercialRegistration || undefined,
        street: settings.street,
        buildingNumber: settings.buildingNumber,
        district: settings.district,
        city: settings.regionCity,
        postalCode: settings.postalCode,
        country: settings.addressCountry || 'SA',
      },
      buyer: {
        name: customer?.nameAr || customer?.nameEn || '',
        vatNumber: buyerVat,
        idScheme: receiver.otherIdScheme,
        id: receiver.otherId,
        street: receiver.street,
        buildingNumber: receiver.buildingNumber,
        district: receiver.district,
        city: receiver.regionCity,
        postalCode: receiver.postalCode,
        country: receiver.countryCode || 'SA',
      },
      lines: (invoice.lines || []).map((l) => {
        const p = products.get(l.productId);
        return {
          name: l.description || p?.nameAr || p?.nameEn || p?.code || 'Item',
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice) * rate,
          discount: Number(l.discount || 0) * rate,
          taxRate: Number(l.taxRate || 0),
        };
      }),
    };
  }

  private signing(settings: ComplianceSettings) {
    if (!settings.zatcaPrivateKey || !settings.zatcaCertificate) return undefined;
    try {
      return {
        privateKey: loadPrivateKey(settings.zatcaPrivateKey),
        certificate: parseCertificate(settings.zatcaCertificate),
        signingTime: new Date().toISOString().slice(0, 19),
      };
    } catch (err) {
      throw new BadRequestException(`Invalid ZATCA key or certificate: ${(err as Error).message}`);
    }
  }

  /** Generates the XML with the next ICV/PIH without consuming them. */
  async preview(tenantId: string, invoiceId: string) {
    const settings = await this.settingsService.resolve(tenantId);
    const loaded = await this.source.loadInvoice(tenantId, invoiceId);
    const state = await this.chains.peek(tenantId, ZATCA_CHAIN);
    const input = await this.buildInput(tenantId, settings, loaded, {
      icv: state.counter + 1,
      pih: state.lastHash || ZATCA_INITIAL_PIH,
      uuid: randomUUID(),
    });
    const built = buildZatcaInvoice(input, this.signing(settings));
    return { kind: input.kind, icv: input.icv, pih: input.pih, ...built };
  }

  async submit(tenantId: string, userId: string | null, invoiceId: string): Promise<EInvoice> {
    const settings = await this.settingsService.resolve(tenantId);
    const loaded = await this.source.loadInvoice(tenantId, invoiceId);
    let record = await this.eInvoiceRepo.findOne({
      where: { tenantId, invoiceId, provider: EInvoiceProvider.ZATCA },
    });
    if (record && !RESUBMITTABLE.includes(record.status)) {
      throw new ConflictException(`Invoice already ${record.status} with ZATCA`);
    }
    const conn = this.settingsService.zatcaConnection(settings);

    // A transport failure is retried with the very same XML (its ICV/PIH are
    // already part of the chain); anything else gets a new chain position.
    const reuse = record?.status === EInvoiceStatus.FAILED && !!record.xml && !!record.invoiceHash;
    if (!reuse) {
      const chain = await this.chains.lock(tenantId, ZATCA_CHAIN);
      const input = await this.buildInput(tenantId, settings, loaded, {
        icv: chain.counter + 1,
        pih: chain.lastHash || ZATCA_INITIAL_PIH,
        uuid: randomUUID(),
      });
      const signing = this.signing(settings);
      if (conn && !signing) {
        throw new BadRequestException('A ZATCA private key and certificate are required for phase 2');
      }
      const built = buildZatcaInvoice(input, signing);
      chain.counter = input.icv;
      chain.lastHash = built.invoiceHash;
      await this.chains.save(chain);

      record =
        record ||
        this.eInvoiceRepo.create({
          tenantId,
          invoiceId,
          invoiceType: EInvoiceType.SALES,
          provider: EInvoiceProvider.ZATCA,
        });
      Object.assign(record, {
        documentType: input.typeCode,
        documentSubtype: input.kind,
        internalId: input.invoiceNumber,
        documentDate: input.issueDate,
        totalAmount: built.totals.taxInclusive,
        uuid: input.uuid,
        icv: input.icv,
        previousHash: input.pih,
        invoiceHash: built.invoiceHash,
        xml: built.xml,
        qrContent: built.qr,
        status: EInvoiceStatus.PENDING,
      });
    }
    record = record!;
    record.attempts = (record.attempts || 0) + 1;
    record.submittedBy = userId as any;
    record.validationErrors = null as any;
    record.warnings = null as any;
    record.lastError = null as any;

    if (!conn) {
      // Phase 1 only (no CSID yet): the XML and QR are generated locally.
      record.lastError = 'No ZATCA CSID configured: generated locally (phase 1), not reported';
      return this.eInvoiceRepo.save(record);
    }

    try {
      const req = { invoiceHash: record.invoiceHash, uuid: record.uuid, xml: record.xml };
      const result =
        record.documentSubtype === ZatcaInvoiceKind.STANDARD
          ? await this.api.clear(conn, req)
          : await this.api.report(conn, req);
      record.status = result.status;
      record.response = result.data;
      record.validationErrors = result.errors;
      record.warnings = result.warnings;
      record.submittedAt = new Date();
      if (result.status === EInvoiceStatus.FAILED) record.lastError = result.errors[0]?.message;
      if (result.status === EInvoiceStatus.CLEARED || result.status === EInvoiceStatus.REPORTED) {
        record.validatedAt = new Date();
      }
      if (result.clearedXml) {
        record.xml = result.clearedXml;
        record.qrContent = extractQrFromXml(result.clearedXml) || record.qrContent;
      }
    } catch (err) {
      if (!(err instanceof ComplianceTransportError)) throw err;
      this.logger.warn(`ZATCA submission failed for ${record.internalId}: ${err.message}`);
      record.status = EInvoiceStatus.FAILED;
      record.lastError = err.message;
    }
    return this.eInvoiceRepo.save(record);
  }
}
