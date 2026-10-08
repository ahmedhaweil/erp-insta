import { BadRequestException } from '@nestjs/common';
import { ReceiverType } from '../entities/compliance-party.entity';

/** ETA amounts carry at most 5 decimal places. */
export const ETA_DECIMALS = 5;
/** Individuals (type P) must be identified at or above this total (EGP). */
export const ETA_PERSON_ID_THRESHOLD = 50000;

export function round5(value: number): number {
  const v = Number(value);
  // Half away from zero at 5 decimals, robust to binary representation
  // (e.g. 1.000005 -> 1.00001).
  const sign = v < 0 ? -1 : 1;
  const scaled = Math.abs(v) * 1e5;
  const rounded = Math.round(Number(scaled.toPrecision(15)));
  return (sign * rounded) / 1e5 || 0;
}

export interface EtaAddress {
  branchID?: string;
  country: string;
  governate: string;
  regionCity: string;
  street: string;
  buildingNumber: string;
  postalCode?: string;
  floor?: string;
  room?: string;
  landmark?: string;
  additionalInformation?: string;
}

export interface EtaIssuerInput {
  rin: string;
  name: string;
  activityCode: string;
  address: EtaAddress & { branchID: string };
}

export interface EtaReceiverInput {
  type: ReceiverType;
  id?: string | null;
  name?: string | null;
  address?: Partial<EtaAddress>;
}

export interface EtaLineInput {
  description: string;
  itemType: string;
  itemCode: string;
  unitType: string;
  internalCode: string;
  quantity: number;
  /** Unit price in the document currency, excluding tax. */
  unitPrice: number;
  /** Absolute line discount in the document currency. */
  discount: number;
  /** VAT rate in percent. */
  taxRate: number;
  taxSubtype: string;
}

export interface EtaDocumentInput {
  documentType: 'I' | 'C' | 'D';
  version: string;
  /** UTC timestamp, e.g. 2026-01-10T08:00:00Z. */
  dateTimeIssued: string;
  internalId: string;
  currencyCode: string;
  /** EGP per unit of the document currency (1 for EGP). */
  exchangeRate: number;
  issuer: EtaIssuerInput;
  receiver: EtaReceiverInput;
  lines: EtaLineInput[];
  /** UUIDs of the original documents (required for credit/debit notes). */
  references?: string[];
  salesOrderReference?: string;
}

const REQUIRED_ADDRESS_FIELDS: (keyof EtaAddress)[] = [
  'country',
  'governate',
  'regionCity',
  'street',
  'buildingNumber',
];

/** Computes one ETA invoice line (all amounts in EGP, 5 decimals). */
export function buildEtaLine(line: EtaLineInput, currencyCode: string, exchangeRate: number) {
  const rate = Number(exchangeRate) || 1;
  const foreign = currencyCode !== 'EGP';
  const quantity = round5(Math.abs(Number(line.quantity)));
  const amountEGP = round5(Number(line.unitPrice) * rate);
  const salesTotal = round5(quantity * amountEGP);
  const discountAmount = round5(Math.abs(Number(line.discount || 0)) * rate);
  const netTotal = round5(salesTotal - discountAmount);
  const taxRate = Number(line.taxRate || 0);
  const taxAmount = round5((netTotal * taxRate) / 100);
  const total = round5(netTotal + taxAmount);

  const unitValue: Record<string, unknown> = foreign
    ? {
        currencySold: currencyCode,
        amountEGP,
        amountSold: round5(Number(line.unitPrice)),
        currencyExchangeRate: round5(rate),
      }
    : { currencySold: 'EGP', amountEGP };

  return {
    description: line.description,
    itemType: line.itemType,
    itemCode: line.itemCode,
    unitType: line.unitType,
    quantity,
    internalCode: line.internalCode,
    salesTotal,
    total,
    valueDifference: 0,
    totalTaxableFees: 0,
    netTotal,
    itemsDiscount: 0,
    unitValue,
    discount: { rate: 0, amount: discountAmount },
    taxableItems: [
      {
        taxType: 'T1',
        amount: taxAmount,
        subType: line.taxSubtype || (taxRate > 0 ? 'V009' : 'V003'),
        rate: round5(taxRate),
      },
    ],
  };
}

export type EtaInvoiceLine = ReturnType<typeof buildEtaLine>;

/** Header totals derived from the (already rounded) lines. */
export function computeEtaTotals(lines: EtaInvoiceLine[], extraDiscountAmount = 0) {
  const sum = (f: (l: EtaInvoiceLine) => number) => round5(lines.reduce((s, l) => s + f(l), 0));
  const taxByType = new Map<string, number>();
  for (const line of lines) {
    for (const tax of line.taxableItems) {
      taxByType.set(tax.taxType, (taxByType.get(tax.taxType) || 0) + tax.amount);
    }
  }
  return {
    totalDiscountAmount: sum((l) => l.discount.amount),
    totalSalesAmount: sum((l) => l.salesTotal),
    netAmount: sum((l) => l.netTotal),
    taxTotals: [...taxByType.entries()].map(([taxType, amount]) => ({
      taxType,
      amount: round5(amount),
    })),
    totalAmount: round5(sum((l) => l.total) - extraDiscountAmount),
    extraDiscountAmount: round5(extraDiscountAmount),
    totalItemsDiscountAmount: sum((l) => l.itemsDiscount),
  };
}

function missingAddressFields(address: Partial<EtaAddress> | undefined): string[] {
  return REQUIRED_ADDRESS_FIELDS.filter((f) => !address || !String(address[f] ?? '').trim());
}

/** Validates and shapes the receiver according to ETA's B/P/F rules. */
export function buildEtaReceiver(receiver: EtaReceiverInput, totalAmountEGP: number) {
  const errors: string[] = [];
  const id = (receiver.id || '').trim();
  const address = receiver.address || {};

  if (receiver.type === ReceiverType.BUSINESS) {
    if (!/^\d{9}$/.test(id)) errors.push('Business receiver requires a 9-digit tax registration number');
    const missing = missingAddressFields(address);
    if (missing.length) errors.push(`Business receiver address is missing: ${missing.join(', ')}`);
    if (!receiver.name) errors.push('Business receiver requires a name');
  } else if (receiver.type === ReceiverType.PERSON) {
    if (totalAmountEGP >= ETA_PERSON_ID_THRESHOLD) {
      if (!/^\d{14}$/.test(id)) {
        errors.push(
          `Individual receiver requires a 14-digit national ID for invoices of ${ETA_PERSON_ID_THRESHOLD} EGP or more`,
        );
      }
      if (!receiver.name) errors.push('Individual receiver requires a name at or above the threshold');
    } else if (id && !/^\d{14}$/.test(id)) {
      errors.push('Individual receiver national ID must have 14 digits');
    }
  } else if (receiver.type === ReceiverType.FOREIGNER) {
    if ((address.country || '').toUpperCase() === 'EG') {
      errors.push('Foreign receiver country cannot be EG');
    }
  }
  if (errors.length) throw new BadRequestException({ message: 'Invalid ETA receiver', errors });

  const shapedAddress: Record<string, string> = {
    country: (address.country || (receiver.type === ReceiverType.FOREIGNER ? '' : 'EG')).toUpperCase(),
    governate: address.governate || '',
    regionCity: address.regionCity || '',
    street: address.street || '',
    buildingNumber: address.buildingNumber || '',
  };
  for (const key of ['postalCode', 'floor', 'room', 'landmark', 'additionalInformation'] as const) {
    if (address[key]) shapedAddress[key] = address[key] as string;
  }
  return {
    address: shapedAddress,
    type: receiver.type,
    id,
    name: receiver.name || '',
  };
}

export function validateEtaIssuer(issuer: EtaIssuerInput): void {
  const errors: string[] = [];
  if (!/^\d{9}$/.test(issuer.rin || '')) errors.push('Issuer RIN must be a 9-digit tax registration number');
  if (!issuer.name) errors.push('Issuer name is required');
  if (!issuer.activityCode) errors.push('Taxpayer activity code is required');
  const missing = missingAddressFields(issuer.address);
  if (missing.length) errors.push(`Issuer address is missing: ${missing.join(', ')}`);
  if (errors.length) throw new BadRequestException({ message: 'Incomplete ETA settings', errors });
}

/**
 * Builds the ETA document JSON (v1.0 / v0.9) without signatures. The key
 * order here is the order of the JSON body and thus of the serialization.
 */
export function buildEtaDocument(input: EtaDocumentInput): Record<string, any> {
  validateEtaIssuer(input.issuer);
  if (!input.lines.length) throw new BadRequestException('An ETA document requires at least one line');
  if ((input.documentType === 'C' || input.documentType === 'D') && !input.references?.length) {
    throw new BadRequestException(
      'A credit/debit note requires the ETA UUID of the original invoice (submit the original first)',
    );
  }

  const invoiceLines = input.lines.map((l) => buildEtaLine(l, input.currencyCode, input.exchangeRate));
  const totals = computeEtaTotals(invoiceLines);
  const receiver = buildEtaReceiver(input.receiver, totals.totalAmount);

  const { address, ...issuerRest } = input.issuer;
  const issuerAddress: Record<string, string> = {
    branchID: address.branchID || '0',
    country: address.country,
    governate: address.governate,
    regionCity: address.regionCity,
    street: address.street,
    buildingNumber: address.buildingNumber,
  };
  for (const key of ['postalCode', 'floor', 'room', 'landmark', 'additionalInformation'] as const) {
    if (address[key]) issuerAddress[key] = address[key] as string;
  }

  const document: Record<string, any> = {
    issuer: { address: issuerAddress, type: 'B', id: issuerRest.rin, name: issuerRest.name },
    receiver,
    documentType: input.documentType,
    documentTypeVersion: input.version,
    dateTimeIssued: input.dateTimeIssued,
    taxpayerActivityCode: input.issuer.activityCode,
    internalID: input.internalId,
  };
  if (input.salesOrderReference) document.salesOrderReference = input.salesOrderReference;
  if (input.references?.length) document.references = input.references;
  document.invoiceLines = invoiceLines;
  Object.assign(document, totals);
  return document;
}

/** Formats a Date / ISO date as ETA's UTC timestamp (no milliseconds). */
export function etaDateTime(value: Date | string): string {
  const d = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00Z`)
    : new Date(value);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
