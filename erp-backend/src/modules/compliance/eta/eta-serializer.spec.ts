import { etaSerialize, etaSerializeForSigning } from './eta-serializer';

describe('etaSerialize (ETA canonical serialization)', () => {
  it('quotes simple values and uppercases property names', () => {
    expect(etaSerialize({ documentType: 'I', documentTypeVersion: '1.0' })).toBe(
      '"DOCUMENTTYPE""I""DOCUMENTTYPEVERSION""1.0"',
    );
  });

  it('serializes the issuer block exactly as in the ETA SDK documentation example', () => {
    const issuer = {
      issuer: {
        address: {
          branchID: '0',
          country: 'EG',
          governate: 'Cairo',
          regionCity: 'Nasr City',
          street: '580 Clementina Key',
          buildingNumber: 'Bldg. 0',
          postalCode: '68030',
          floor: '1',
          room: '123',
          landmark: '7660 Melody Trail',
          additionalInformation: 'beside Townhall',
        },
        type: 'B',
        id: '113317713',
        name: 'Issuer Company',
      },
    };
    expect(etaSerialize(issuer)).toBe(
      '"ISSUER""ADDRESS""BRANCHID""0""COUNTRY""EG""GOVERNATE""Cairo""REGIONCITY""Nasr City"' +
        '"STREET""580 Clementina Key""BUILDINGNUMBER""Bldg. 0""POSTALCODE""68030""FLOOR""1""ROOM""123"' +
        '"LANDMARK""7660 Melody Trail""ADDITIONALINFORMATION""beside Townhall""TYPE""B""ID""113317713"' +
        '"NAME""Issuer Company"',
    );
  });

  it('writes an array name once, then again before every element', () => {
    const doc = {
      invoiceLines: [
        {
          description: 'Computer1',
          itemType: 'GS1',
          quantity: 1,
          taxableItems: [
            { taxType: 'T1', amount: 14, subType: 'V009', rate: 14 },
            { taxType: 'T2', amount: 1.5, subType: 'Tbl01', rate: 1.5 },
          ],
        },
        { description: 'Computer2', itemType: 'EGS', quantity: 2.5, taxableItems: [] },
      ],
    };
    expect(etaSerialize(doc)).toBe(
      '"INVOICELINES"' +
        '"INVOICELINES""DESCRIPTION""Computer1""ITEMTYPE""GS1""QUANTITY""1"' +
        '"TAXABLEITEMS"' +
        '"TAXABLEITEMS""TAXTYPE""T1""AMOUNT""14""SUBTYPE""V009""RATE""14"' +
        '"TAXABLEITEMS""TAXTYPE""T2""AMOUNT""1.5""SUBTYPE""Tbl01""RATE""1.5"' +
        '"INVOICELINES""DESCRIPTION""Computer2""ITEMTYPE""EGS""QUANTITY""2.5"' +
        '"TAXABLEITEMS"',
    );
  });

  it('serializes the references array of credit notes (array of strings)', () => {
    expect(etaSerialize({ references: ['UUID1', 'UUID2'] })).toBe(
      '"REFERENCES""REFERENCES""UUID1""REFERENCES""UUID2"',
    );
  });

  it('formats numbers like JSON.stringify and keeps strings raw (no escaping)', () => {
    expect(etaSerialize({ a: 100, b: 0.1 + 0.2, c: 1e21, d: 'He said "hi"', e: 0 })).toBe(
      `"A""100""B""${JSON.stringify(0.1 + 0.2)}""C""1e+21""D""He said "hi"""E""0"`,
    );
  });

  it('serializes null as an empty value and skips undefined properties', () => {
    expect(etaSerialize({ a: null, b: undefined, c: '' })).toBe('"A""""C"""');
  });

  it('keeps the document property order (the JSON body order)', () => {
    expect(etaSerialize({ z: '1', a: '2' })).toBe('"Z""1""A""2"');
  });

  it('rejects non-finite numbers', () => {
    expect(() => etaSerialize({ a: Number.NaN })).toThrow();
  });

  it('excludes signatures when serializing for signing', () => {
    const doc = { internalID: 'INV-1', signatures: [{ signatureType: 'I', value: 'abc' }] };
    expect(etaSerializeForSigning(doc)).toBe('"INTERNALID""INV-1"');
    expect(doc.signatures).toHaveLength(1);
  });
});
