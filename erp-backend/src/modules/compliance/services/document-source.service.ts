import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { SalesInvoice, SalesInvoiceStatus } from '@modules/sales/entities/sales-invoice.entity';
import { Customer } from '@modules/sales/entities/customer.entity';
import { Product } from '@modules/inventory/entities/product.entity';
import { Currency } from '@modules/accounting/entities/currency.entity';
import { ComplianceParty, ReceiverType } from '../entities/compliance-party.entity';
import { ComplianceSettingsService } from './compliance-settings.service';

/** Sales invoice statuses that may be reported to a tax authority. */
export const REPORTABLE_STATUSES = [
  SalesInvoiceStatus.POSTED,
  SalesInvoiceStatus.SENT,
  SalesInvoiceStatus.PAID,
  SalesInvoiceStatus.PARTIAL,
  SalesInvoiceStatus.OVERDUE,
];

export interface LoadedInvoice {
  invoice: SalesInvoice;
  customer: Customer | null;
  party: ComplianceParty | null;
  products: Map<string, Product>;
  currencyCode: string | null;
}

/** Reads the sales documents (read-only) that are turned into e-documents. */
@Injectable()
export class DocumentSourceService {
  constructor(
    @InjectRepository(SalesInvoice)
    private readonly invoiceRepo: Repository<SalesInvoice>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(Currency)
    private readonly currencyRepo: Repository<Currency>,
    private readonly settingsService: ComplianceSettingsService,
  ) {}

  async loadInvoice(tenantId: string, invoiceId: string): Promise<LoadedInvoice> {
    const invoice = await this.invoiceRepo.findOne({
      where: { id: invoiceId, tenantId },
      relations: ['lines'],
    });
    if (!invoice) throw new NotFoundException('Sales invoice not found');
    if (!REPORTABLE_STATUSES.includes(invoice.status)) {
      throw new BadRequestException('Only posted invoices and credit notes can be submitted');
    }
    const customer = await this.customerRepo.findOne({ where: { id: invoice.customerId, tenantId } });
    const party = await this.settingsService.findParty(tenantId, invoice.customerId);
    const products = await this.loadProducts(tenantId, (invoice.lines || []).map((l) => l.productId));
    let currencyCode: string | null = null;
    if (invoice.currencyId) {
      const currency = await this.currencyRepo.findOne({ where: { id: invoice.currencyId } });
      currencyCode = currency?.code || null;
    }
    return { invoice, customer, party, products, currencyCode };
  }

  findInvoice(tenantId: string, invoiceId: string): Promise<SalesInvoice | null> {
    return this.invoiceRepo.findOne({ where: { id: invoiceId, tenantId } });
  }

  async loadProducts(tenantId: string, ids: string[]): Promise<Map<string, Product>> {
    if (!ids.length) return new Map();
    const products = await this.productRepo.find({ where: { tenantId, id: In([...new Set(ids)]) } });
    return new Map(products.map((p) => [p.id, p]));
  }

  findCustomer(tenantId: string, customerId: string): Promise<Customer | null> {
    return this.customerRepo.findOne({ where: { id: customerId, tenantId } });
  }
}

/**
 * Receiver profile: the explicit compliance profile, else inferred from the
 * customer master (9-digit tax id -> B, 14-digit -> P, foreign country -> F).
 */
export function inferReceiver(customer: Customer | null, party: ComplianceParty | null) {
  if (party) {
    return {
      type: party.receiverType,
      id: party.identifier || '',
      countryCode: party.countryCode || 'EG',
      governate: party.governate,
      regionCity: party.regionCity,
      street: party.street,
      buildingNumber: party.buildingNumber,
      postalCode: party.postalCode,
      district: party.district,
      otherIdScheme: party.otherIdScheme,
      otherId: party.otherId,
    };
  }
  const taxId = (customer?.taxId || '').replace(/\D/g, '');
  const country = normalizeCountry(customer?.country);
  let type: ReceiverType = ReceiverType.PERSON;
  if (country && country !== 'EG' && country !== 'SA') type = ReceiverType.FOREIGNER;
  else if (taxId.length === 9 || taxId.length === 15) type = ReceiverType.BUSINESS;
  return {
    type,
    id: taxId,
    countryCode: country || 'EG',
    governate: customer?.city || '',
    regionCity: customer?.city || '',
    street: customer?.address || '',
    buildingNumber: '',
    postalCode: '',
    district: '',
    otherIdScheme: undefined as string | undefined,
    otherId: undefined as string | undefined,
  };
}

const COUNTRY_NAMES: Record<string, string> = {
  egypt: 'EG',
  'مصر': 'EG',
  'saudi arabia': 'SA',
  ksa: 'SA',
  'السعودية': 'SA',
};

export function normalizeCountry(value?: string | null): string | null {
  if (!value) return null;
  const v = value.trim();
  if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
  return COUNTRY_NAMES[v.toLowerCase()] || null;
}
