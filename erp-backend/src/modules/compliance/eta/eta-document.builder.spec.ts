import { BadRequestException } from '@nestjs/common';
import {
  buildEtaDocument,
  buildEtaLine,
  buildEtaReceiver,
  computeEtaTotals,
  EtaDocumentInput,
  etaDateTime,
  round5,
} from './eta-document.builder';
import { ReceiverType } from '../entities/compliance-party.entity';

const issuer = {
  rin: '113317713',
  name: 'Issuer Company',
  activityCode: '4620',
  address: {
    branchID: '0',
    country: 'EG',
    governate: 'Cairo',
    regionCity: 'Nasr City',
    street: '580 Clementina Key',
    buildingNumber: 'Bldg. 0',
  },
};

const businessReceiver = {
  type: ReceiverType.BUSINESS,
  id: '313717919',
  name: 'Receiver',
  address: {
    country: 'EG',
    governate: 'Giza',
    regionCity: 'Dokki',
    street: 'Tahrir St',
    buildingNumber: '12',
  },
};

const line = (over: Partial<Parameters<typeof buildEtaLine>[0]> = {}) => ({
  description: 'Computer',
  itemType: 'EGS',
  itemCode: 'EG-113317713-1001',
  unitType: 'EA',
  internalCode: 'P-1',
  quantity: 2,
  unitPrice: 100,
  discount: 0,
  taxRate: 14,
  taxSubtype: 'V009',
  ...over,
});

const docInput = (over: Partial<EtaDocumentInput> = {}): EtaDocumentInput => ({
  documentType: 'I',
  version: '1.0',
  dateTimeIssued: '2026-01-10T08:00:00Z',
  internalId: 'INV-000001',
  currencyCode: 'EGP',
  exchangeRate: 1,
  issuer,
  receiver: businessReceiver,
  lines: [line()],
  ...over,
});

describe('round5', () => {
  it.each([
    [1.000005, 1.00001],
    [0.123454, 0.12345],
    [0.123455, 0.12346],
    [2.675, 2.675],
    [1 / 3, 0.33333],
    [-1.000005, -1.00001],
    [0.1 + 0.2, 0.3],
    [-0, 0],
  ])('round5(%p) = %p', (input, expected) => {
    expect(round5(input)).toBe(expected);
  });
});

describe('buildEtaLine', () => {
  it('computes salesTotal, discount, netTotal, VAT and total', () => {
    const l = buildEtaLine(line({ quantity: 3, unitPrice: 33.33333, discount: 10, taxRate: 14 }), 'EGP', 1);
    expect(l.salesTotal).toBe(99.99999);
    expect(l.discount).toEqual({ rate: 0, amount: 10 });
    expect(l.netTotal).toBe(89.99999);
    expect(l.taxableItems).toEqual([{ taxType: 'T1', amount: 12.6, subType: 'V009', rate: 14 }]);
    expect(l.total).toBe(102.59999);
    expect(l.unitValue).toEqual({ currencySold: 'EGP', amountEGP: 33.33333 });
  });

  it('converts foreign currency lines to EGP and keeps the sold amount', () => {
    const l = buildEtaLine(line({ quantity: 1, unitPrice: 10, taxRate: 14 }), 'USD', 48.12345);
    expect(l.unitValue).toEqual({
      currencySold: 'USD',
      amountEGP: 481.2345,
      amountSold: 10,
      currencyExchangeRate: 48.12345,
    });
    expect(l.salesTotal).toBe(481.2345);
    expect(l.taxableItems[0].amount).toBe(67.37283);
  });

  it('uses positive quantities for credit notes built from negative lines', () => {
    expect(buildEtaLine(line({ quantity: -2 }), 'EGP', 1).quantity).toBe(2);
  });

  it('defaults the subtype to V003 (exempt) for 0% lines', () => {
    expect(buildEtaLine(line({ taxRate: 0, taxSubtype: '' }), 'EGP', 1).taxableItems[0]).toEqual({
      taxType: 'T1',
      amount: 0,
      subType: 'V003',
      rate: 0,
    });
  });
});

describe('computeEtaTotals', () => {
  it('sums rounded line values and keeps netAmount = totalSales - totalDiscount', () => {
    const lines = [
      buildEtaLine(line({ quantity: 1, unitPrice: 0.33333, discount: 0.1, taxRate: 14 }), 'EGP', 1),
      buildEtaLine(line({ quantity: 7, unitPrice: 1.11111, discount: 0, taxRate: 14 }), 'EGP', 1),
      buildEtaLine(line({ quantity: 1, unitPrice: 50, discount: 5, taxRate: 0, taxSubtype: 'V003' }), 'EGP', 1),
    ];
    const totals = computeEtaTotals(lines);
    expect(totals.totalSalesAmount).toBe(58.11110);
    expect(totals.totalDiscountAmount).toBe(5.1);
    expect(totals.netAmount).toBe(round5(totals.totalSalesAmount - totals.totalDiscountAmount));
    expect(totals.taxTotals).toEqual([{ taxType: 'T1', amount: round5(0.03267 + 1.08889 + 0) }]);
    expect(totals.totalAmount).toBe(round5(totals.netAmount + totals.taxTotals[0].amount));
    // every amount has at most 5 decimals
    for (const v of [totals.totalSalesAmount, totals.netAmount, totals.totalAmount]) {
      expect(Number(v.toFixed(5))).toBe(v);
    }
  });
});

describe('buildEtaReceiver', () => {
  it('requires a 9-digit RIN and full address for businesses', () => {
    expect(() => buildEtaReceiver({ ...businessReceiver, id: '12345' }, 100)).toThrow(BadRequestException);
    expect(() =>
      buildEtaReceiver({ ...businessReceiver, address: { ...businessReceiver.address, street: '' } }, 100),
    ).toThrow(BadRequestException);
    expect(buildEtaReceiver(businessReceiver, 100)).toMatchObject({ type: 'B', id: '313717919' });
  });

  it('does not require a national id for individuals below 50,000 EGP', () => {
    expect(buildEtaReceiver({ type: ReceiverType.PERSON }, 49999.99999)).toEqual({
      address: { country: 'EG', governate: '', regionCity: '', street: '', buildingNumber: '' },
      type: 'P',
      id: '',
      name: '',
    });
  });

  it('requires a 14-digit national id and name for individuals at or above 50,000 EGP', () => {
    expect(() => buildEtaReceiver({ type: ReceiverType.PERSON, name: 'Ali' }, 50000)).toThrow(
      BadRequestException,
    );
    expect(
      buildEtaReceiver({ type: ReceiverType.PERSON, id: '29001011234567', name: 'Ali' }, 50000),
    ).toMatchObject({ type: 'P', id: '29001011234567', name: 'Ali' });
  });

  it('rejects a malformed national id even below the threshold', () => {
    expect(() => buildEtaReceiver({ type: ReceiverType.PERSON, id: '123' }, 10)).toThrow(BadRequestException);
  });

  it('rejects foreign receivers located in Egypt', () => {
    expect(() =>
      buildEtaReceiver({ type: ReceiverType.FOREIGNER, address: { country: 'EG' } }, 10),
    ).toThrow(BadRequestException);
    expect(
      buildEtaReceiver({ type: ReceiverType.FOREIGNER, name: 'ACME', address: { country: 'de' } }, 10).address
        .country,
    ).toBe('DE');
  });
});

describe('buildEtaDocument', () => {
  it('builds a v1.0 invoice with header totals in ETA field order', () => {
    const doc = buildEtaDocument(docInput());
    expect(Object.keys(doc)).toEqual([
      'issuer',
      'receiver',
      'documentType',
      'documentTypeVersion',
      'dateTimeIssued',
      'taxpayerActivityCode',
      'internalID',
      'invoiceLines',
      'totalDiscountAmount',
      'totalSalesAmount',
      'netAmount',
      'taxTotals',
      'totalAmount',
      'extraDiscountAmount',
      'totalItemsDiscountAmount',
    ]);
    expect(doc.issuer).toEqual({
      address: {
        branchID: '0',
        country: 'EG',
        governate: 'Cairo',
        regionCity: 'Nasr City',
        street: '580 Clementina Key',
        buildingNumber: 'Bldg. 0',
      },
      type: 'B',
      id: '113317713',
      name: 'Issuer Company',
    });
    expect(doc.totalSalesAmount).toBe(200);
    expect(doc.taxTotals).toEqual([{ taxType: 'T1', amount: 28 }]);
    expect(doc.totalAmount).toBe(228);
    expect(doc.signatures).toBeUndefined();
  });

  it('applies the individual threshold on the document total', () => {
    const big = docInput({
      receiver: { type: ReceiverType.PERSON, name: 'Ali' },
      lines: [line({ quantity: 1, unitPrice: 43860, taxRate: 14 })], // 50,000.4 with VAT
    });
    expect(() => buildEtaDocument(big)).toThrow(BadRequestException);
    const small = docInput({
      receiver: { type: ReceiverType.PERSON },
      lines: [line({ quantity: 1, unitPrice: 43859, taxRate: 14 })], // 49,999.26
    });
    expect(buildEtaDocument(small).receiver.type).toBe('P');
  });

  it('requires references for credit notes and includes them', () => {
    expect(() => buildEtaDocument(docInput({ documentType: 'C' }))).toThrow(BadRequestException);
    const doc = buildEtaDocument(docInput({ documentType: 'C', references: ['ABC'] }));
    expect(doc.documentType).toBe('C');
    expect(doc.references).toEqual(['ABC']);
  });

  it('reports incomplete issuer settings', () => {
    expect(() => buildEtaDocument(docInput({ issuer: { ...issuer, rin: '' } }))).toThrow(BadRequestException);
    expect(() => buildEtaDocument(docInput({ issuer: { ...issuer, activityCode: '' } }))).toThrow(
      BadRequestException,
    );
  });
});

describe('etaDateTime', () => {
  it('formats dates and timestamps as UTC without milliseconds', () => {
    expect(etaDateTime('2026-01-10')).toBe('2026-01-10T00:00:00Z');
    expect(etaDateTime(new Date('2026-01-10T08:09:10.123Z'))).toBe('2026-01-10T08:09:10Z');
  });
});
