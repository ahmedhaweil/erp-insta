import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, Repository } from 'typeorm';
import { PosOrder, PosPaymentMethod } from '@modules/pos/entities/pos-order.entity';
import { PosSession } from '@modules/pos/entities/pos-session.entity';
import { EReceipt } from '../entities/e-receipt.entity';
import { EInvoiceStatus } from '../entities/e-invoice.entity';
import { ComplianceSettings, EtaPosDevice } from '../entities/compliance-settings.entity';
import { ComplianceSettingsService } from './compliance-settings.service';
import { ComplianceChainService } from './compliance-chain.service';
import { DocumentSourceService } from './document-source.service';
import { ItemCodesService } from './item-codes.service';
import {
  buildEtaReceipt,
  EtaReceiptPaymentMethod,
  etaReceiptQr,
} from '../eta/eta-receipt.builder';
import { etaDateTime } from '../eta/eta-document.builder';
import { EtaApiClient } from '../eta/eta-api.client';
import { EtaApiError } from '../eta/eta-errors';
import { flattenEtaError, mapEtaStatus } from '../eta/eta-status';
import { ComplianceTransportError } from '../http/compliance-http.client';
import { ListComplianceDocumentsDto } from '../dto/submit-invoice.dto';
import { dateRange } from './e-invoice.service';

const PAYMENT_METHODS: Record<PosPaymentMethod, EtaReceiptPaymentMethod> = {
  [PosPaymentMethod.CASH]: EtaReceiptPaymentMethod.CASH,
  [PosPaymentMethod.CARD]: EtaReceiptPaymentMethod.VISA,
  [PosPaymentMethod.SPLIT]: EtaReceiptPaymentMethod.OTHERS,
};

export const receiptChainKey = (serial: string) => `eta-receipt:${serial}`;

/** ETA e-receipts (B2C) for POS orders. */
@Injectable()
export class EReceiptService {
  private readonly logger = new Logger(EReceiptService.name);

  constructor(
    @InjectRepository(EReceipt)
    private readonly receiptRepo: Repository<EReceipt>,
    @InjectRepository(PosOrder)
    private readonly orderRepo: Repository<PosOrder>,
    @InjectRepository(PosSession)
    private readonly sessionRepo: Repository<PosSession>,
    private readonly settingsService: ComplianceSettingsService,
    private readonly chains: ComplianceChainService,
    private readonly source: DocumentSourceService,
    private readonly itemCodes: ItemCodesService,
    private readonly api: EtaApiClient,
  ) {}

  private async loadOrder(tenantId: string, posOrderId: string) {
    const order = await this.orderRepo.findOne({ where: { id: posOrderId, tenantId }, relations: ['lines'] });
    if (!order) throw new NotFoundException('POS order not found');
    const session = await this.sessionRepo.findOne({ where: { id: order.sessionId, tenantId } });
    return { order, terminalId: session?.terminalId };
  }

  resolveDevice(settings: ComplianceSettings, terminalId?: string): EtaPosDevice {
    const devices = settings.posDevices || [];
    const device =
      devices.find((d) => terminalId && d.terminalId === terminalId) ||
      (devices.length === 1 && !devices[0].terminalId ? devices[0] : undefined) ||
      devices.find((d) => !d.terminalId);
    if (!device) {
      throw new BadRequestException('No ETA POS device is registered for this terminal (compliance settings)');
    }
    return device;
  }

  /** Builds the receipt JSON for a POS order with the given previous UUID. */
  async buildReceipt(
    tenantId: string,
    settings: ComplianceSettings,
    order: PosOrder,
    device: EtaPosDevice,
    previousUUID: string,
  ) {
    const products = await this.source.loadProducts(tenantId, order.lines.map((l) => l.productId));
    const codes = await this.itemCodes.mapForProducts(tenantId, order.lines.map((l) => l.productId));
    const missing = order.lines.filter((l) => !codes.get(l.productId));
    if (missing.length) {
      throw new BadRequestException({
        message: 'ETA item codes are missing for some products',
        errors: missing.map((l) => `Product ${products.get(l.productId)?.code || l.productId} has no ETA item code`),
      });
    }

    let referenceUUID: string | undefined;
    if (order.refundedOrderId) {
      const original = await this.receiptRepo.findOne({ where: { tenantId, posOrderId: order.refundedOrderId } });
      if (!original) {
        throw new BadRequestException('Submit the e-receipt of the original sale before its return');
      }
      referenceUUID = original.uuid;
    }
    const customer = order.customerId ? await this.source.findCustomer(tenantId, order.customerId) : null;

    return buildEtaReceipt({
      receiptNumber: order.orderNumber,
      dateTimeIssued: etaDateTime(order.createdAt || new Date()),
      receiptType: order.refundedOrderId ? 'R' : 'S',
      previousUUID,
      referenceUUID,
      seller: {
        rin: settings.taxpayerId,
        companyTradeName: settings.taxpayerName,
        branchCode: settings.branchCode || '0',
        branchAddress: {
          country: 'EG', // ETA issuers are Egyptian taxpayers
          governate: settings.governate || '',
          regionCity: settings.regionCity || '',
          street: settings.street || '',
          buildingNumber: settings.buildingNumber || '',
        },
        deviceSerialNumber: device.serial,
        activityCode: settings.activityCode,
      },
      buyer: {
        type: 'P',
        name: customer ? customer.nameEn || customer.nameAr : '',
        mobileNumber: customer?.phone || '',
      },
      lines: order.lines.map((l) => {
        const product = products.get(l.productId);
        const code = codes.get(l.productId)!;
        return {
          internalCode: product?.code || l.productId,
          description: product?.nameEn || product?.nameAr || 'Item',
          itemType: code.itemType,
          itemCode: code.itemCode,
          unitType:
            code.unitType || (product?.unitId && settings.unitTypeMap?.[product.unitId]) || settings.defaultUnitType || 'EA',
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          discount: Number(l.discount || 0),
          taxRate: Number(l.taxRate || 0),
          taxSubtype: code.taxSubtype || (Number(l.taxRate) > 0 ? settings.defaultTaxSubtype || 'V009' : ''),
        };
      }),
      paymentMethod: PAYMENT_METHODS[order.paymentMethod] || EtaReceiptPaymentMethod.OTHERS,
    });
  }

  async preview(tenantId: string, posOrderId: string) {
    const settings = await this.settingsService.resolve(tenantId);
    const { order, terminalId } = await this.loadOrder(tenantId, posOrderId);
    const device = this.resolveDevice(settings, terminalId);
    const state = await this.chains.peek(tenantId, receiptChainKey(device.serial));
    const receipt = await this.buildReceipt(tenantId, settings, order, device, state.lastHash || '');
    const portal = this.settingsService.etaUrls(settings).portal;
    return { receipt, qrContent: etaReceiptQr(portal, receipt as any) };
  }

  async submit(tenantId: string, posOrderId: string): Promise<EReceipt> {
    const settings = await this.settingsService.resolve(tenantId);
    const { order, terminalId } = await this.loadOrder(tenantId, posOrderId);
    const device = this.resolveDevice(settings, terminalId);
    const portal = this.settingsService.etaUrls(settings).portal;

    let record = await this.receiptRepo.findOne({ where: { tenantId, posOrderId } });
    if (record && ![EInvoiceStatus.PENDING, EInvoiceStatus.INVALID, EInvoiceStatus.FAILED].includes(record.status)) {
      throw new ConflictException(`Receipt already ${record.status} at ETA`);
    }

    // A transport failure is retried unchanged (the uuid is already chained).
    if (!(record?.status === EInvoiceStatus.FAILED && record.payload)) {
      const chain = await this.chains.lock(tenantId, receiptChainKey(device.serial));
      const receipt = await this.buildReceipt(tenantId, settings, order, device, chain.lastHash || '');
      chain.lastHash = receipt.header.uuid;
      chain.counter += 1;
      await this.chains.save(chain);
      record = record || this.receiptRepo.create({ tenantId, posOrderId });
      Object.assign(record, {
        receiptNumber: receipt.header.receiptNumber,
        receiptType: receipt.documentType.receiptType,
        deviceSerial: device.serial,
        uuid: receipt.header.uuid,
        previousUuid: receipt.header.previousUUID,
        referenceUuid: receipt.header.referenceUUID || null,
        dateTimeIssued: receipt.header.dateTimeIssued,
        totalAmount: receipt.totalAmount,
        payload: receipt,
        qrContent: etaReceiptQr(portal, receipt as any),
        status: EInvoiceStatus.PENDING,
      });
    }
    record = record!;
    record.attempts = (record.attempts || 0) + 1;
    record.validationErrors = null as any;
    record.lastError = null as any;

    const conn = this.settingsService.etaConnection(settings, device);
    try {
      const res = await this.api.submitReceipts(conn, [record.payload]);
      record.submissionUuid = res.submissionId;
      record.response = res as any;
      record.submittedAt = new Date();
      const rejected = (res.rejectedDocuments || []).find(
        (d) => d.uuid === record!.uuid || d.receiptNumber === record!.receiptNumber,
      );
      if (rejected || !(res.acceptedDocuments || []).length) {
        record.status = EInvoiceStatus.INVALID;
        record.validationErrors = flattenEtaError(rejected?.error);
      } else {
        record.status = EInvoiceStatus.SUBMITTED;
      }
    } catch (err) {
      if (err instanceof EtaApiError) {
        record.response = err.data;
        record.lastError = err.message;
        record.status = err.isClientError ? EInvoiceStatus.INVALID : EInvoiceStatus.FAILED;
        if (err.isClientError) record.validationErrors = flattenEtaError(err.data?.error || err.data);
      } else if (err instanceof ComplianceTransportError) {
        record.status = EInvoiceStatus.FAILED;
        record.lastError = err.message;
      } else {
        throw err;
      }
    }
    return this.receiptRepo.save(record);
  }

  async findById(tenantId: string, id: string): Promise<EReceipt> {
    const receipt = await this.receiptRepo.findOne({ where: { id, tenantId } });
    if (!receipt) throw new NotFoundException('E-receipt not found');
    return receipt;
  }

  async refresh(tenantId: string, id: string): Promise<EReceipt> {
    const record = await this.findById(tenantId, id);
    if (!record.submissionUuid) return record;
    const settings = await this.settingsService.resolve(tenantId);
    const device = (settings.posDevices || []).find((d) => d.serial === record.deviceSerial);
    if (!device) throw new BadRequestException('The POS device of this receipt is no longer registered');
    const conn = this.settingsService.etaConnection(settings, device);
    record.lastCheckedAt = new Date();
    try {
      const details = await this.api.getReceiptSubmission(conn, record.submissionUuid);
      const list: any[] = details?.receipts || details?.documentSummary || details?.receiptSummary || [];
      const mine = list.find((r) => r.uuid === record.uuid) || (list.length === 1 ? list[0] : null);
      const status = mapEtaStatus(mine?.status || details?.status);
      record.status = status;
      if (status === EInvoiceStatus.INVALID) {
        record.validationErrors = (mine?.errors || details?.errors || []).flatMap((e: any) => flattenEtaError(e));
      }
      record.response = details;
      record.lastError = null as any;
    } catch (err) {
      if (err instanceof EtaApiError || err instanceof ComplianceTransportError) {
        record.lastError = err.message;
      } else {
        throw err;
      }
    }
    return this.receiptRepo.save(record);
  }

  async getQr(tenantId: string, id: string) {
    const r = await this.findById(tenantId, id);
    return { uuid: r.uuid, status: r.status, qrContent: r.qrContent };
  }

  async findAll(tenantId: string, query: ListComplianceDocumentsDto = {}) {
    const page = query.page || 1;
    const limit = query.limit || 25;
    const base: FindOptionsWhere<EReceipt> = { tenantId };
    if (query.status) base.status = query.status;
    const range = dateRange(query.from, query.to ? `${query.to}T23:59:59Z` : undefined);
    if (range) base.dateTimeIssued = range as any;
    const where = query.search
      ? [
          { ...base, receiptNumber: ILike(`%${query.search}%`) },
          { ...base, uuid: ILike(`%${query.search}%`) },
        ]
      : base;
    const [items, total] = await this.receiptRepo.findAndCount({
      where,
      order: { createdAt: (query.order || 'desc').toUpperCase() as 'ASC' | 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}
