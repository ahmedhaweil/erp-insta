import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { etaSerialize } from './eta-serializer';
import { EtaAddress, round5 } from './eta-document.builder';

/** ETA e-receipt payment method codes. */
export enum EtaReceiptPaymentMethod {
  CASH = 'C',
  VISA = 'V',
  CASH_WITH_CONTRACTOR = 'CC',
  VISA_WITH_CONTRACTOR = 'VC',
  VOUCHERS = 'VO',
  PROMOTION = 'PR',
  GIFT_CARD = 'GC',
  POINTS = 'P',
  OTHERS = 'O',
}

export interface EtaReceiptLineInput {
  internalCode: string;
  description: string;
  itemType: string;
  itemCode: string;
  unitType: string;
  quantity: number;
  /** Unit price excluding tax. */
  unitPrice: number;
  /** Absolute commercial discount on the line. */
  discount: number;
  taxRate: number;
  taxSubtype: string;
}

export interface EtaReceiptInput {
  receiptNumber: string;
  /** UTC timestamp without milliseconds. */
  dateTimeIssued: string;
  receiptType: 'S' | 'R';
  /** uuid of the previous receipt of the same POS device ('' for the first one). */
  previousUUID: string;
  /** Return receipts: uuid of the original sale receipt. */
  referenceUUID?: string;
  currency?: string;
  seller: {
    rin: string;
    companyTradeName: string;
    branchCode: string;
    branchAddress: EtaAddress;
    deviceSerialNumber: string;
    activityCode: string;
  };
  buyer: { type: 'P' | 'B' | 'F'; id?: string; name?: string; mobileNumber?: string };
  lines: EtaReceiptLineInput[];
  paymentMethod: EtaReceiptPaymentMethod | string;
}

export function buildEtaReceiptLine(line: EtaReceiptLineInput) {
  const quantity = round5(Math.abs(Number(line.quantity)));
  const unitPrice = round5(Number(line.unitPrice));
  const totalSale = round5(quantity * unitPrice);
  const discount = round5(Math.abs(Number(line.discount || 0)));
  const netSale = round5(totalSale - discount);
  const rate = Number(line.taxRate || 0);
  const taxAmount = round5((netSale * rate) / 100);
  const item: Record<string, any> = {
    internalCode: line.internalCode,
    description: line.description,
    itemType: line.itemType,
    itemCode: line.itemCode,
    unitType: line.unitType,
    quantity,
    unitPrice,
    netSale,
    totalSale,
    total: round5(netSale + taxAmount),
  };
  if (discount > 0) {
    item.commercialDiscountData = [{ amount: discount, description: 'Discount' }];
  }
  item.taxableItems = [
    { taxType: 'T1', amount: taxAmount, subType: line.taxSubtype || (rate > 0 ? 'V009' : 'V003'), rate: round5(rate) },
  ];
  return item;
}

/**
 * Builds an ETA e-receipt (v1.2) and computes its UUID. The UUID is the
 * SHA-256 (lowercase hex) of the canonical serialization of the receipt with
 * `header.uuid` set to the empty string.
 */
export function buildEtaReceipt(input: EtaReceiptInput): Record<string, any> {
  const errors: string[] = [];
  if (!/^\d{9}$/.test(input.seller.rin || '')) errors.push('Seller RIN must be a 9-digit registration number');
  if (!input.seller.deviceSerialNumber) errors.push('POS device serial number is required');
  if (!input.seller.activityCode) errors.push('Taxpayer activity code is required');
  if (!input.lines.length) errors.push('A receipt requires at least one item');
  if (input.receiptType === 'R' && !input.referenceUUID) {
    errors.push('A return receipt requires the uuid of the original sale receipt');
  }
  if (errors.length) throw new BadRequestException({ message: 'Invalid ETA e-receipt', errors });

  const itemData = input.lines.map(buildEtaReceiptLine);
  const sum = (f: (i: any) => number) => round5(itemData.reduce((s, i) => s + f(i), 0));
  const totalTax = sum((i) => i.taxableItems[0].amount);

  const header: Record<string, any> = {
    dateTimeIssued: input.dateTimeIssued,
    receiptNumber: input.receiptNumber,
    uuid: '',
    previousUUID: input.previousUUID || '',
    referenceOldUUID: '',
    currency: input.currency || 'EGP',
  };
  if (input.receiptType === 'R') header.referenceUUID = input.referenceUUID;

  const receipt: Record<string, any> = {
    header,
    documentType: { receiptType: input.receiptType, typeVersion: '1.2' },
    seller: {
      rin: input.seller.rin,
      companyTradeName: input.seller.companyTradeName,
      branchCode: input.seller.branchCode || '0',
      branchAddress: input.seller.branchAddress,
      deviceSerialNumber: input.seller.deviceSerialNumber,
      activityCode: input.seller.activityCode,
    },
    buyer: {
      type: input.buyer.type,
      id: input.buyer.id || '',
      name: input.buyer.name || '',
      mobileNumber: input.buyer.mobileNumber || '',
    },
    itemData,
    totalSales: sum((i) => i.totalSale),
    totalCommercialDiscount: sum((i) => i.commercialDiscountData?.[0]?.amount || 0),
    totalItemsDiscount: 0,
    netAmount: sum((i) => i.netSale),
    feesAmount: 0,
    totalAmount: sum((i) => i.total),
    taxTotals: [{ taxType: 'T1', amount: totalTax }],
    paymentMethod: input.paymentMethod,
  };
  receipt.header.uuid = computeReceiptUuid(receipt);
  return receipt;
}

/** SHA-256 over the serialized receipt with an empty header.uuid. */
export function computeReceiptUuid(receipt: Record<string, any>): string {
  const copy = JSON.parse(JSON.stringify(receipt));
  copy.header.uuid = '';
  return createHash('sha256').update(etaSerialize(copy), 'utf8').digest('hex');
}

/**
 * QR content printed on the receipt:
 * {portal}/receipts/search/{uuid}/share/{dateTimeIssued}#Total:{total},IssuerRIN:{rin}
 */
export function etaReceiptQr(
  portalUrl: string,
  receipt: { header: { uuid: string; dateTimeIssued: string }; totalAmount: number; seller: { rin: string } },
): string {
  return (
    `${portalUrl.replace(/\/$/, '')}/receipts/search/${receipt.header.uuid}/share/` +
    `${receipt.header.dateTimeIssued}#Total:${receipt.totalAmount},IssuerRIN:${receipt.seller.rin}`
  );
}
