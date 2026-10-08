import { createHash } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import {
  buildEtaReceipt,
  computeReceiptUuid,
  EtaReceiptInput,
  EtaReceiptPaymentMethod,
  etaReceiptQr,
} from './eta-receipt.builder';
import { etaSerialize } from './eta-serializer';

const input = (over: Partial<EtaReceiptInput> = {}): EtaReceiptInput => ({
  receiptNumber: 'POS-000001',
  dateTimeIssued: '2026-01-10T08:00:00Z',
  receiptType: 'S',
  previousUUID: '',
  seller: {
    rin: '113317713',
    companyTradeName: 'Shop',
    branchCode: '0',
    branchAddress: {
      country: 'EG',
      governate: 'Cairo',
      regionCity: 'Nasr City',
      street: 'Main',
      buildingNumber: '1',
    },
    deviceSerialNumber: 'SN-001',
    activityCode: '4711',
  },
  buyer: { type: 'P' },
  lines: [
    {
      internalCode: 'P-1',
      description: 'Juice',
      itemType: 'GS1',
      itemCode: '6223000000017',
      unitType: 'EA',
      quantity: 2,
      unitPrice: 10,
      discount: 1,
      taxRate: 14,
      taxSubtype: 'V009',
    },
  ],
  paymentMethod: EtaReceiptPaymentMethod.CASH,
  ...over,
});

describe('ETA e-receipt builder', () => {
  it('computes line and header totals', () => {
    const r = buildEtaReceipt(input());
    expect(r.itemData[0]).toMatchObject({
      quantity: 2,
      unitPrice: 10,
      totalSale: 20,
      netSale: 19,
      total: 21.66,
      commercialDiscountData: [{ amount: 1, description: 'Discount' }],
      taxableItems: [{ taxType: 'T1', amount: 2.66, subType: 'V009', rate: 14 }],
    });
    expect(r).toMatchObject({
      totalSales: 20,
      totalCommercialDiscount: 1,
      netAmount: 19,
      totalAmount: 21.66,
      taxTotals: [{ taxType: 'T1', amount: 2.66 }],
      paymentMethod: 'C',
      documentType: { receiptType: 'S', typeVersion: '1.2' },
    });
  });

  it('sets uuid = SHA-256 hex of the serialized receipt with an empty uuid', () => {
    const r = buildEtaReceipt(input());
    const copy = JSON.parse(JSON.stringify(r));
    copy.header.uuid = '';
    const expected = createHash('sha256').update(etaSerialize(copy)).digest('hex');
    expect(r.header.uuid).toBe(expected);
    expect(r.header.uuid).toMatch(/^[0-9a-f]{64}$/);
    // the serialized form starts with the header and an empty uuid value
    expect(etaSerialize(copy).startsWith(
      '"HEADER""DATETIMEISSUED""2026-01-10T08:00:00Z""RECEIPTNUMBER""POS-000001""UUID""""PREVIOUSUUID"""',
    )).toBe(true);
    expect(computeReceiptUuid(r)).toBe(r.header.uuid);
  });

  it('is deterministic and depends on the previous receipt (chaining)', () => {
    const first = buildEtaReceipt(input());
    expect(buildEtaReceipt(input()).header.uuid).toBe(first.header.uuid);
    const second = buildEtaReceipt(input({ receiptNumber: 'POS-000002', previousUUID: first.header.uuid }));
    expect(second.header.previousUUID).toBe(first.header.uuid);
    const unchained = buildEtaReceipt(input({ receiptNumber: 'POS-000002' }));
    expect(second.header.uuid).not.toBe(unchained.header.uuid);
  });

  it('requires the original uuid for returns and records it', () => {
    expect(() => buildEtaReceipt(input({ receiptType: 'R' }))).toThrow(BadRequestException);
    const r = buildEtaReceipt(input({ receiptType: 'R', referenceUUID: 'abc' }));
    expect(r.header.referenceUUID).toBe('abc');
    expect(r.documentType.receiptType).toBe('R');
  });

  it('builds positive amounts for returns made of negative POS lines', () => {
    const r = buildEtaReceipt(
      input({
        receiptType: 'R',
        referenceUUID: 'abc',
        lines: [{ ...input().lines[0], quantity: -2, discount: -1 }],
      }),
    );
    expect(r.totalAmount).toBe(21.66);
  });

  it('validates seller data', () => {
    expect(() =>
      buildEtaReceipt(input({ seller: { ...input().seller, deviceSerialNumber: '' } })),
    ).toThrow(BadRequestException);
  });

  it('builds the e-receipt QR content', () => {
    const r = buildEtaReceipt(input());
    expect(etaReceiptQr('https://invoicing.eta.gov.eg/', r as any)).toBe(
      `https://invoicing.eta.gov.eg/receipts/search/${r.header.uuid}/share/2026-01-10T08:00:00Z#Total:21.66,IssuerRIN:113317713`,
    );
  });
});
