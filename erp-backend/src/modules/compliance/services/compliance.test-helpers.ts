/* Shared fixtures for the compliance service specs. */
import { SalesInvoiceStatus, SalesInvoiceType } from '@modules/sales/entities/sales-invoice.entity';
import { ComplianceCountry, EtaEnvironment, ZatcaEnvironment } from '../entities/compliance-settings.entity';
import { EtaItemType } from '../entities/eta-item-code.entity';
import { ReceiverType } from '../entities/compliance-party.entity';

export function etaSettings(over: Record<string, any> = {}): any {
  return {
    tenantId: 't1',
    country: ComplianceCountry.EG,
    isEnabled: true,
    autoSubmit: false,
    taxpayerId: '113317713',
    taxpayerName: 'Issuer Co',
    branchCode: '0',
    activityCode: '4620',
    addressCountry: 'EG',
    governate: 'Cairo',
    regionCity: 'Nasr City',
    street: 'Main',
    buildingNumber: '1',
    etaEnvironment: EtaEnvironment.PREPROD,
    etaClientId: 'cid',
    etaClientSecret: 'csecret',
    etaDocumentVersion: '1.0',
    defaultUnitType: 'EA',
    defaultTaxSubtype: 'V009',
    unitTypeMap: {},
    posDevices: [{ terminalId: 'term-1', serial: 'SN-1', presharedKey: 'psk' }],
    zatcaEnvironment: ZatcaEnvironment.SANDBOX,
    zatcaSimplifiedDefault: true,
    ...over,
  };
}

export function postedInvoice(over: Record<string, any> = {}): any {
  return {
    id: 'inv-1',
    tenantId: 't1',
    invoiceNumber: 'INV-000001',
    customerId: 'cust-1',
    status: SalesInvoiceStatus.POSTED,
    moveType: SalesInvoiceType.INVOICE,
    date: '2026-01-10',
    postedAt: new Date('2026-01-10T09:00:00Z'),
    exchangeRate: 1,
    subtotal: 200,
    taxAmount: 28,
    totalAmount: 228,
    lines: [
      { id: 'l1', productId: 'p1', quantity: 2, unitPrice: 100, discount: 0, taxRate: 14, lineTotal: 200 },
    ],
    ...over,
  };
}

export function loadedInvoice(over: Record<string, any> = {}): any {
  return {
    invoice: postedInvoice(),
    customer: { id: 'cust-1', nameEn: 'Receiver Co', nameAr: 'المستلم', taxId: '313717919', phone: '1' },
    party: {
      customerId: 'cust-1',
      receiverType: ReceiverType.BUSINESS,
      identifier: '313717919',
      countryCode: 'EG',
      governate: 'Giza',
      regionCity: 'Dokki',
      street: 'Tahrir',
      buildingNumber: '5',
    },
    products: new Map([['p1', { id: 'p1', code: 'P-1', nameEn: 'Laptop', unitId: 'u1' }]]),
    currencyCode: null,
    ...over,
  };
}

export function itemCodeMap() {
  return new Map([
    ['p1', { productId: 'p1', itemType: EtaItemType.EGS, itemCode: 'EG-113317713-1001', unitType: null, taxSubtype: null }],
  ]);
}

export function mockRepo() {
  return {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
    create: jest.fn((x) => ({ ...x })),
    save: jest.fn(async (x) => ({ id: x.id || 'e-1', ...x })),
  };
}
