import { BadRequestException } from '@nestjs/common';
import { createHash, verify, X509Certificate } from 'crypto';
import {
  buildZatcaInvoice,
  computeZatcaTotals,
  extractQrFromXml,
  ZatcaInvoiceInput,
  ZatcaInvoiceKind,
  zatcaHashInput,
  zatcaInvoiceHash,
} from './zatca-xml.builder';
import {
  certificateSignature,
  loadPrivateKey,
  normalizeCertificate,
  parseCertificate,
  ZATCA_INITIAL_PIH,
} from './zatca-crypto';
import { decodeTlv } from './zatca-tlv';
import { TEST_CERTIFICATE, TEST_PRIVATE_KEY } from './zatca.fixtures';

const input = (over: Partial<ZatcaInvoiceInput> = {}): ZatcaInvoiceInput => ({
  invoiceNumber: 'INV-000001',
  uuid: '3cf5ee18-ee25-44ea-a444-2c37ba7f28be',
  issueDate: '2026-01-10',
  issueTime: '12:21:28',
  typeCode: '388',
  kind: ZatcaInvoiceKind.SIMPLIFIED,
  icv: 1,
  pih: ZATCA_INITIAL_PIH,
  seller: {
    name: 'Maximum Speed Tech Supply LTD',
    vatNumber: '399999999900003',
    idScheme: 'CRN',
    id: '1010010000',
    street: 'Prince Sultan',
    buildingNumber: '2322',
    district: 'Al-Murabba',
    city: 'Riyadh',
    postalCode: '23333',
    country: 'SA',
  },
  lines: [
    { name: 'Pencil', quantity: 2, unitPrice: 2, discount: 0, taxRate: 15 },
    { name: 'Book & Pen', quantity: 1, unitPrice: 10.555, discount: 0.555, taxRate: 15 },
  ],
  ...over,
});

const signing = () => ({
  privateKey: loadPrivateKey(TEST_PRIVATE_KEY),
  certificate: parseCertificate(TEST_CERTIFICATE),
  signingTime: '2026-01-10T12:21:30',
});

describe('ZATCA totals', () => {
  it('computes line, tax subtotal and monetary totals with 2 decimals', () => {
    const t = computeZatcaTotals(input().lines);
    expect(t.lines.map((l) => [l.lineExtension, l.taxAmount])).toEqual([
      [4, 0.6],
      [10, 1.5],
    ]);
    expect(t.subtotals).toEqual([{ category: 'S', rate: 15, taxable: 14, tax: 2.1 }]);
    expect(t).toMatchObject({ lineExtension: 14, taxExclusive: 14, taxTotal: 2.1, taxInclusive: 16.1, payable: 16.1 });
  });

  it('uses category O (not subject) for 0% lines', () => {
    const t = computeZatcaTotals([{ name: 'x', quantity: 1, unitPrice: 5, discount: 0, taxRate: 0 }]);
    expect(t.subtotals).toEqual([{ category: 'O', rate: 0, taxable: 5, tax: 0 }]);
  });
});

describe('ZATCA UBL invoice', () => {
  it('emits a phase-1 invoice with ICV, PIH, QR and KSA type code', () => {
    const built = buildZatcaInvoice(input());
    expect(built.xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"')).toBe(true);
    expect(built.xml).toContain('<cbc:InvoiceTypeCode name="0200000">388</cbc:InvoiceTypeCode>');
    expect(built.xml).toContain('<cac:AdditionalDocumentReference><cbc:ID>ICV</cbc:ID><cbc:UUID>1</cbc:UUID></cac:AdditionalDocumentReference>');
    expect(built.xml).toContain(`<cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${ZATCA_INITIAL_PIH}</cbc:EmbeddedDocumentBinaryObject>`);
    expect(built.xml).toContain('<cbc:Name>Book &amp; Pen</cbc:Name>');
    expect(built.xml).toContain('<cbc:PayableAmount currencyID="SAR">16.10</cbc:PayableAmount>');
    expect(built.xml).not.toContain('UBLExtensions');
    expect(built.signature).toBeNull();
    expect(extractQrFromXml(built.xml)).toBe(built.qr);
    expect(decodeTlv(built.qr).map((f) => f.value.toString())).toEqual([
      'Maximum Speed Tech Supply LTD',
      '399999999900003',
      '2026-01-10T12:21:28',
      '16.10',
      '2.10',
    ]);
  });

  it('never self-closes elements and has no whitespace between elements (canonical form)', () => {
    const xml = buildZatcaInvoice(input(), signing()).xml.split('\n')[1];
    expect(xml).not.toMatch(/\/>/);
    expect(xml).not.toMatch(/>\s+</);
  });

  it('hashes the invoice without UBLExtensions, cac:Signature and the QR reference', () => {
    const built = buildZatcaInvoice(input(), signing());
    const stripped = built.xml
      .replace(/^<\?xml[^>]*\?>\n/, '')
      .replace(/<ext:UBLExtensions>.*<\/ext:UBLExtensions>/, '')
      .replace(/<cac:Signature>.*?<\/cac:Signature>/, '')
      .replace(/<cac:AdditionalDocumentReference><cbc:ID>QR<\/cbc:ID>.*?<\/cac:AdditionalDocumentReference>/, '');
    expect(stripped).toBe(zatcaHashInput(input()));
    const expectedHash = createHash('sha256').update(stripped).digest('base64');
    expect(built.invoiceHash).toBe(expectedHash);
    expect(zatcaInvoiceHash(input())).toBe(expectedHash);
    expect(built.xml).toContain(`<ds:DigestValue>${expectedHash}</ds:DigestValue>`);
  });

  it('changes the hash when the chain (PIH / ICV) changes', () => {
    const a = zatcaInvoiceHash(input());
    expect(zatcaInvoiceHash(input({ icv: 2 }))).not.toBe(a);
    expect(zatcaInvoiceHash(input({ pih: a }))).not.toBe(a);
  });

  it('signs the invoice hash with ECDSA secp256k1 and embeds a 9-tag QR (simplified)', () => {
    const s = signing();
    const built = buildZatcaInvoice(input(), s);
    const x509 = new X509Certificate(normalizeCertificate(TEST_CERTIFICATE).pem);
    expect(
      verify('sha256', Buffer.from(built.invoiceHash, 'base64'), x509.publicKey, Buffer.from(built.signature!, 'base64')),
    ).toBe(true);

    const tags = decodeTlv(built.qr);
    expect(tags.map((t) => t.tag)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(tags[5].value.toString()).toBe(built.invoiceHash);
    expect(tags[6].value.toString()).toBe(built.signature);
    expect(tags[7].value.equals(s.certificate.publicKey)).toBe(true);
    expect(tags[8].value.equals(s.certificate.signature)).toBe(true);

    expect(built.xml).toContain('<ds:SignatureValue>' + built.signature + '</ds:SignatureValue>');
    expect(built.xml).toContain(`<ds:X509Certificate>${s.certificate.body}</ds:X509Certificate>`);
    expect(built.xml).toContain('<xades:SigningTime>2026-01-10T12:21:30</xades:SigningTime>');
    expect(built.xml).toContain('<cac:Signature><cbc:ID>urn:oasis:names:specification:ubl:signature:Invoice</cbc:ID>');
  });

  it('omits the certificate signature tag for standard invoices', () => {
    const built = buildZatcaInvoice(
      input({
        kind: ZatcaInvoiceKind.STANDARD,
        buyer: {
          name: 'Fatoora Samples LTD',
          vatNumber: '399999999800003',
          street: 'Salah Al-Din',
          buildingNumber: '1111',
          district: 'Al-Murooj',
          city: 'Riyadh',
          postalCode: '12222',
          country: 'SA',
        },
      }),
      signing(),
    );
    expect(decodeTlv(built.qr).map((t) => t.tag)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(built.xml).toContain('<cbc:InvoiceTypeCode name="0100000">388</cbc:InvoiceTypeCode>');
    expect(built.xml).toContain('<cac:PartyTaxScheme><cbc:CompanyID>399999999800003</cbc:CompanyID>');
  });

  it('validates standard invoice buyers and credit note references', () => {
    expect(() => buildZatcaInvoice(input({ kind: ZatcaInvoiceKind.STANDARD }))).toThrow(BadRequestException);
    expect(() => buildZatcaInvoice(input({ typeCode: '381' }))).toThrow(BadRequestException);
    expect(() =>
      buildZatcaInvoice(input({ seller: { ...input().seller, vatNumber: '123' } })),
    ).toThrow(BadRequestException);
  });

  it('emits credit notes as 381 with billing reference and reason', () => {
    const xml = buildZatcaInvoice(
      input({ typeCode: '381', billingReference: 'INV-000001', instructionNote: 'Returned goods' }),
    ).xml;
    expect(xml).toContain('<cbc:InvoiceTypeCode name="0200000">381</cbc:InvoiceTypeCode>');
    expect(xml).toContain('<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>INV-000001</cbc:ID>');
    expect(xml).toContain('<cbc:InstructionNote>Returned goods</cbc:InstructionNote>');
  });
});

describe('ZATCA certificate helpers', () => {
  it('parses public key, issuer, serial and certificate signature', () => {
    const info = parseCertificate(TEST_CERTIFICATE);
    const x509 = new X509Certificate(TEST_CERTIFICATE);
    expect(info.issuerName).toBe('CN=TST-886431145-399999999900003, O=Test EGS, C=SA');
    expect(info.serialNumber).toBe(BigInt('0x' + x509.serialNumber).toString());
    expect(info.publicKey.length).toBe(88); // secp256k1 SPKI DER
    // the certificate signature verifies the TBS part with the (self-signed) key
    expect(info.signature[0]).toBe(0x30);
    expect(certificateSignature(x509.raw).equals(info.signature)).toBe(true);
  });

  it('accepts a bare base64 body or a binarySecurityToken', () => {
    const { body } = normalizeCertificate(TEST_CERTIFICATE);
    expect(normalizeCertificate(body).body).toBe(body);
    const token = Buffer.from(body).toString('base64');
    expect(normalizeCertificate(token).body).toBe(body);
  });

  it('accepts a private key without PEM armour', () => {
    const body = TEST_PRIVATE_KEY.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    expect(loadPrivateKey(body).asymmetricKeyDetails?.namedCurve).toBe('secp256k1');
  });

  it('seeds the PIH chain with base64(hex(sha256("0")))', () => {
    expect(ZATCA_INITIAL_PIH).toBe(
      'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==',
    );
  });
});
