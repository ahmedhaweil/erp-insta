import { BadRequestException } from '@nestjs/common';
import { KeyObject } from 'crypto';
import { round } from '@shared/utils/document-totals.util';
import {
  CertificateInfo,
  sha256,
  sha256HexBase64,
  signInvoiceHash,
} from './zatca-crypto';
import { zatcaQr } from './zatca-tlv';

/**
 * ZATCA (Fatoora) UBL 2.1 invoice generation, hashing and signing.
 *
 * Canonicalization (pragmatic, documented limitation): the hash ZATCA expects
 * is SHA-256 over the C14N 1.1 canonical form of the invoice without
 * ext:UBLExtensions, cac:Signature and the QR AdditionalDocumentReference.
 * Instead of running a general C14N engine, this builder emits XML that is
 * already in canonical form: no whitespace between elements, explicit end
 * tags (never self-closing), namespace declarations only on the root in
 * C14N order, a single attribute per element and C14N character escaping.
 * The hashed string is produced by rendering the same document with the three
 * excluded blocks omitted and without the XML declaration, which equals the
 * C14N output for documents produced here. XML that is edited or
 * pretty-printed afterwards (or received from elsewhere) must be re-hashed
 * with a real C14N 1.1 implementation. The signed-properties digest follows
 * the template used by the ZATCA SDK. Validate a sample with the ZATCA SDK
 * (`fatoora -validate`) before going live.
 */

export const UBL_NS = {
  invoice: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
  cac: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
  cbc: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
  ext: 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
};

export enum ZatcaInvoiceKind {
  STANDARD = 'standard',
  SIMPLIFIED = 'simplified',
}

export interface ZatcaParty {
  name: string;
  vatNumber?: string;
  /** Additional id: scheme (CRN, NAT, IQA, PAS, TIN, ...) and value. */
  idScheme?: string;
  id?: string;
  street?: string;
  buildingNumber?: string;
  district?: string;
  city?: string;
  postalCode?: string;
  country?: string;
}

export interface ZatcaLineInput {
  name: string;
  quantity: number;
  unitPrice: number;
  /** Absolute discount on the line (excl. VAT). */
  discount: number;
  taxRate: number;
  unitCode?: string;
}

export interface ZatcaInvoiceInput {
  invoiceNumber: string;
  uuid: string;
  issueDate: string;
  issueTime: string;
  /** 388 invoice, 381 credit note, 383 debit note. */
  typeCode: '388' | '381' | '383';
  kind: ZatcaInvoiceKind;
  currency?: string;
  icv: number;
  pih: string;
  /** Credit/debit notes: number of the original invoice. */
  billingReference?: string;
  /** Credit/debit notes: reason for issuance (KSA-10). */
  instructionNote?: string;
  /** 10 cash, 30 credit, 42 bank account, 48 bank card, 1 not defined. */
  paymentMeansCode?: string;
  deliveryDate?: string;
  seller: ZatcaParty & { vatNumber: string };
  buyer?: ZatcaParty;
  lines: ZatcaLineInput[];
  note?: string;
}

export interface ZatcaLineTotals {
  lineExtension: number;
  taxAmount: number;
  taxCategory: string;
  taxRate: number;
}

export interface ZatcaTotals {
  lines: ZatcaLineTotals[];
  lineExtension: number;
  taxExclusive: number;
  taxTotal: number;
  taxInclusive: number;
  payable: number;
  subtotals: { category: string; rate: number; taxable: number; tax: number }[];
}

const r2 = (v: number) => round(v, 2);
const amt = (v: number) => r2(v).toFixed(2);
const qty = (v: number) => String(round(v, 6));

export function computeZatcaTotals(lines: ZatcaLineInput[]): ZatcaTotals {
  const computed = lines.map((l) => {
    const lineExtension = r2(Math.abs(l.quantity) * l.unitPrice - Math.abs(l.discount || 0));
    const taxRate = Number(l.taxRate || 0);
    return {
      lineExtension,
      taxAmount: r2((lineExtension * taxRate) / 100),
      taxCategory: taxRate > 0 ? 'S' : 'O',
      taxRate,
    };
  });
  const groups = new Map<string, { category: string; rate: number; taxable: number; tax: number }>();
  for (const l of computed) {
    const key = `${l.taxCategory}:${l.taxRate}`;
    const g = groups.get(key) || { category: l.taxCategory, rate: l.taxRate, taxable: 0, tax: 0 };
    g.taxable = r2(g.taxable + l.lineExtension);
    groups.set(key, g);
  }
  const subtotals = [...groups.values()].map((g) => ({ ...g, tax: r2((g.taxable * g.rate) / 100) }));
  const lineExtension = r2(computed.reduce((s, l) => s + l.lineExtension, 0));
  const taxTotal = r2(subtotals.reduce((s, g) => s + g.tax, 0));
  const taxInclusive = r2(lineExtension + taxTotal);
  return {
    lines: computed,
    lineExtension,
    taxExclusive: lineExtension,
    taxTotal,
    taxInclusive,
    payable: taxInclusive,
    subtotals,
  };
}

// ---- canonical XML writer --------------------------------------------------

function escText(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;');
}

function escAttr(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/\t/g, '&#x9;')
    .replace(/\n/g, '&#xA;')
    .replace(/\r/g, '&#xD;');
}

function attrs(a?: Record<string, string>): string {
  if (!a) return '';
  // C14N: namespace declarations first (default, then by prefix), then attributes by name.
  const keys = Object.keys(a).sort((x, y) => {
    const nx = x === 'xmlns' ? 0 : x.startsWith('xmlns:') ? 1 : 2;
    const ny = y === 'xmlns' ? 0 : y.startsWith('xmlns:') ? 1 : 2;
    return nx - ny || (x < y ? -1 : x > y ? 1 : 0);
  });
  return keys.map((k) => ` ${k}="${escAttr(a[k])}"`).join('');
}

/** Text leaf. */
export function t(name: string, text: string | number, a?: Record<string, string>): string {
  return `<${name}${attrs(a)}>${escText(String(text))}</${name}>`;
}

/** Element with children (null/undefined/'' children are skipped). */
export function e(name: string, children: (string | null | undefined | false)[], a?: Record<string, string>): string {
  return `<${name}${attrs(a)}>${children.filter(Boolean).join('')}</${name}>`;
}

const taxScheme = () => e('cac:TaxScheme', [t('cbc:ID', 'VAT')]);

function partyXml(party: ZatcaParty, isSeller: boolean): string {
  const id = party.id && party.idScheme;
  const address =
    party.street || party.city || party.country
      ? e('cac:PostalAddress', [
          party.street && t('cbc:StreetName', party.street),
          party.buildingNumber && t('cbc:BuildingNumber', party.buildingNumber),
          party.district && t('cbc:CitySubdivisionName', party.district),
          party.city && t('cbc:CityName', party.city),
          party.postalCode && t('cbc:PostalZone', party.postalCode),
          e('cac:Country', [t('cbc:IdentificationCode', party.country || 'SA')]),
        ])
      : null;
  return e('cac:Party', [
    id ? e('cac:PartyIdentification', [t('cbc:ID', party.id!, { schemeID: party.idScheme! })]) : null,
    address,
    party.vatNumber
      ? e('cac:PartyTaxScheme', [t('cbc:CompanyID', party.vatNumber), taxScheme()])
      : isSeller
        ? null
        : e('cac:PartyTaxScheme', [taxScheme()]),
    party.name ? e('cac:PartyLegalEntity', [t('cbc:RegistrationName', party.name)]) : null,
  ]);
}

function validate(input: ZatcaInvoiceInput): void {
  const errors: string[] = [];
  if (!/^3\d{13}3$/.test(input.seller.vatNumber || '')) {
    errors.push('Seller VAT number must be 15 digits starting and ending with 3');
  }
  if (!input.seller.name) errors.push('Seller name is required');
  if (!input.lines.length) errors.push('At least one invoice line is required');
  if (input.kind === ZatcaInvoiceKind.STANDARD) {
    const b = input.buyer;
    if (!b?.name) errors.push('Standard invoices require the buyer name');
    if (!b?.vatNumber && !b?.id) errors.push('Standard invoices require the buyer VAT number or another buyer id');
    if (!b?.street || !b?.city || !b?.postalCode || !b?.buildingNumber || !b?.district) {
      errors.push('Standard invoices require the buyer street, building number, district, city and postal code');
    }
  }
  if (input.typeCode !== '388' && !input.billingReference) {
    errors.push('Credit/debit notes require the original invoice number');
  }
  if (errors.length) throw new BadRequestException({ message: 'Invalid ZATCA invoice', errors });
}

interface RenderParts {
  extensions?: string;
  qr?: string;
  withSignature: boolean;
}

/** Renders the invoice; the hash input is render() without extensions/signature/QR. */
function render(input: ZatcaInvoiceInput, totals: ZatcaTotals, parts: RenderParts): string {
  const currency = input.currency || 'SAR';
  const money = (v: number) => t('cbc:TaxAmount', amt(v), { currencyID: currency });
  const subtypeCode = input.kind === ZatcaInvoiceKind.STANDARD ? '0100000' : '0200000';

  const docRef = (id: string, inner: string) => e('cac:AdditionalDocumentReference', [t('cbc:ID', id), inner]);
  const attachment = (value: string) =>
    e('cac:Attachment', [t('cbc:EmbeddedDocumentBinaryObject', value, { mimeCode: 'text/plain' })]);

  const lines = input.lines.map((l, i) => {
    const lt = totals.lines[i];
    return e('cac:InvoiceLine', [
      t('cbc:ID', String(i + 1)),
      t('cbc:InvoicedQuantity', qty(Math.abs(l.quantity)), { unitCode: l.unitCode || 'PCE' }),
      t('cbc:LineExtensionAmount', amt(lt.lineExtension), { currencyID: currency }),
      Math.abs(l.discount || 0) > 0
        ? e('cac:AllowanceCharge', [
            t('cbc:ChargeIndicator', 'false'),
            t('cbc:AllowanceChargeReason', 'discount'),
            t('cbc:Amount', amt(Math.abs(l.discount)), { currencyID: currency }),
          ])
        : null,
      e('cac:TaxTotal', [
        money(lt.taxAmount),
        t('cbc:RoundingAmount', amt(lt.lineExtension + lt.taxAmount), { currencyID: currency }),
      ]),
      e('cac:Item', [
        t('cbc:Name', l.name),
        e('cac:ClassifiedTaxCategory', [
          t('cbc:ID', lt.taxCategory),
          t('cbc:Percent', amt(lt.taxRate)),
          taxScheme(),
        ]),
      ]),
      e('cac:Price', [t('cbc:PriceAmount', String(round(l.unitPrice, 6)), { currencyID: currency })]),
    ]);
  });

  return e(
    'Invoice',
    [
      parts.extensions,
      t('cbc:ProfileID', 'reporting:1.0'),
      t('cbc:ID', input.invoiceNumber),
      t('cbc:UUID', input.uuid),
      t('cbc:IssueDate', input.issueDate),
      t('cbc:IssueTime', input.issueTime),
      t('cbc:InvoiceTypeCode', input.typeCode, { name: subtypeCode }),
      input.note && t('cbc:Note', input.note),
      t('cbc:DocumentCurrencyCode', currency),
      t('cbc:TaxCurrencyCode', currency),
      input.billingReference &&
        e('cac:BillingReference', [e('cac:InvoiceDocumentReference', [t('cbc:ID', input.billingReference)])]),
      docRef('ICV', t('cbc:UUID', String(input.icv))),
      docRef('PIH', attachment(input.pih)),
      parts.qr && docRef('QR', attachment(parts.qr)),
      parts.withSignature &&
        e('cac:Signature', [
          t('cbc:ID', 'urn:oasis:names:specification:ubl:signature:Invoice'),
          t('cbc:SignatureMethod', 'urn:oasis:names:specification:ubl:dsig:enveloped:xades'),
        ]),
      e('cac:AccountingSupplierParty', [partyXml(input.seller, true)]),
      e('cac:AccountingCustomerParty', [input.buyer ? partyXml(input.buyer, false) : null]),
      e('cac:Delivery', [t('cbc:ActualDeliveryDate', input.deliveryDate || input.issueDate)]),
      e('cac:PaymentMeans', [
        t('cbc:PaymentMeansCode', input.paymentMeansCode || '10'),
        input.instructionNote && t('cbc:InstructionNote', input.instructionNote),
      ]),
      e('cac:TaxTotal', [money(totals.taxTotal)]),
      e('cac:TaxTotal', [
        money(totals.taxTotal),
        ...totals.subtotals.map((s) =>
          e('cac:TaxSubtotal', [
            t('cbc:TaxableAmount', amt(s.taxable), { currencyID: currency }),
            money(s.tax),
            e('cac:TaxCategory', [
              t('cbc:ID', s.category),
              t('cbc:Percent', amt(s.rate)),
              s.category === 'O' && t('cbc:TaxExemptionReasonCode', 'VATEX-SA-OOS'),
              s.category === 'O' && t('cbc:TaxExemptionReason', 'Not subject to VAT'),
              taxScheme(),
            ]),
          ]),
        ),
      ]),
      e('cac:LegalMonetaryTotal', [
        t('cbc:LineExtensionAmount', amt(totals.lineExtension), { currencyID: currency }),
        t('cbc:TaxExclusiveAmount', amt(totals.taxExclusive), { currencyID: currency }),
        t('cbc:TaxInclusiveAmount', amt(totals.taxInclusive), { currencyID: currency }),
        t('cbc:AllowanceTotalAmount', '0.00', { currencyID: currency }),
        t('cbc:PrepaidAmount', '0.00', { currencyID: currency }),
        t('cbc:PayableAmount', amt(totals.payable), { currencyID: currency }),
      ]),
      ...lines,
    ],
    {
      xmlns: UBL_NS.invoice,
      'xmlns:cac': UBL_NS.cac,
      'xmlns:cbc': UBL_NS.cbc,
      'xmlns:ext': UBL_NS.ext,
    },
  );
}

/** The canonical hash input (no declaration, extensions, signature or QR). */
export function zatcaHashInput(input: ZatcaInvoiceInput): string {
  return render(input, computeZatcaTotals(input.lines), { withSignature: false });
}

/** Invoice hash: base64 of the binary SHA-256 of the canonical form. */
export function zatcaInvoiceHash(input: ZatcaInvoiceInput): string {
  return sha256(zatcaHashInput(input)).toString('base64');
}

const DS = 'http://www.w3.org/2000/09/xmldsig#';
const XADES = 'http://uri.etsi.org/01903/v1.3.2#';
const SHA256_ALG = 'http://www.w3.org/2001/04/xmlenc#sha256';

function signedPropertiesXml(cert: CertificateInfo, signingTime: string, forDigest: boolean): string {
  // In the digest form the ds namespace is declared where it is used, as in
  // the ZATCA SDK template; in the document it is inherited from ds:Signature.
  const ds = forDigest ? { 'xmlns:ds': DS } : undefined;
  return e(
    'xades:SignedProperties',
    [
      e('xades:SignedSignatureProperties', [
        t('xades:SigningTime', signingTime),
        e('xades:SigningCertificate', [
          e('xades:Cert', [
            e('xades:CertDigest', [
              t('ds:DigestMethod', '', { ...(ds || {}), Algorithm: SHA256_ALG }),
              t('ds:DigestValue', sha256HexBase64(cert.body), ds),
            ]),
            e('xades:IssuerSerial', [
              t('ds:X509IssuerName', cert.issuerName, ds),
              t('ds:X509SerialNumber', cert.serialNumber, ds),
            ]),
          ]),
        ]),
      ]),
    ],
    forDigest ? { 'xmlns:xades': XADES, Id: 'xadesSignedProperties' } : { Id: 'xadesSignedProperties' },
  );
}

function ublExtensions(
  invoiceHash: string,
  signatureValue: string,
  cert: CertificateInfo,
  signingTime: string,
): string {
  const transform = (xpath: string) =>
    e('ds:Transform', [t('ds:XPath', xpath)], { Algorithm: 'http://www.w3.org/TR/1999/REC-xpath-19991116' });
  const signedPropsDigest = sha256HexBase64(signedPropertiesXml(cert, signingTime, true));

  return e('ext:UBLExtensions', [
    e('ext:UBLExtension', [
      t('ext:ExtensionURI', 'urn:oasis:names:specification:ubl:dsig:enveloped:xades'),
      e('ext:ExtensionContent', [
        e(
          'sig:UBLDocumentSignatures',
          [
            e('sac:SignatureInformation', [
              t('cbc:ID', 'urn:oasis:names:specification:ubl:signature:1'),
              t('sbc:ReferencedSignatureID', 'urn:oasis:names:specification:ubl:signature:Invoice'),
              e(
                'ds:Signature',
                [
                  e('ds:SignedInfo', [
                    t('ds:CanonicalizationMethod', '', { Algorithm: 'http://www.w3.org/2006/12/xml-c14n11' }),
                    t('ds:SignatureMethod', '', { Algorithm: 'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256' }),
                    e(
                      'ds:Reference',
                      [
                        e('ds:Transforms', [
                          transform('not(//ancestor-or-self::ext:UBLExtensions)'),
                          transform('not(//ancestor-or-self::cac:Signature)'),
                          transform("not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])"),
                          t('ds:Transform', '', { Algorithm: 'http://www.w3.org/2006/12/xml-c14n11' }),
                        ]),
                        t('ds:DigestMethod', '', { Algorithm: SHA256_ALG }),
                        t('ds:DigestValue', invoiceHash),
                      ],
                      { Id: 'invoiceSignedData', URI: '' },
                    ),
                    e(
                      'ds:Reference',
                      [t('ds:DigestMethod', '', { Algorithm: SHA256_ALG }), t('ds:DigestValue', signedPropsDigest)],
                      { Type: 'http://www.w3.org/2000/09/xmldsig#SignatureProperties', URI: '#xadesSignedProperties' },
                    ),
                  ]),
                  t('ds:SignatureValue', signatureValue),
                  e('ds:KeyInfo', [e('ds:X509Data', [t('ds:X509Certificate', cert.body)])]),
                  e('ds:Object', [
                    e('xades:QualifyingProperties', [signedPropertiesXml(cert, signingTime, false)], {
                      'xmlns:xades': XADES,
                      Target: 'signature',
                    }),
                  ]),
                ],
                { 'xmlns:ds': DS, Id: 'signature' },
              ),
            ]),
          ],
          {
            'xmlns:sig': 'urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2',
            'xmlns:sac': 'urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2',
            'xmlns:sbc': 'urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2',
          },
        ),
      ]),
    ]),
  ]);
}

export interface SignedZatcaInvoice {
  xml: string;
  invoiceHash: string;
  signature: string | null;
  qr: string;
  totals: ZatcaTotals;
}

/**
 * Builds the final invoice. With a key and certificate (phase 2) the invoice
 * is hashed, signed, stamped with the XAdES block and a 9-tag QR (tag 9 only
 * for simplified invoices); otherwise a phase-1 QR (tags 1-5) is embedded.
 */
export function buildZatcaInvoice(
  input: ZatcaInvoiceInput,
  signing?: { privateKey: KeyObject; certificate: CertificateInfo; signingTime?: string },
): SignedZatcaInvoice {
  validate(input);
  const totals = computeZatcaTotals(input.lines);
  const invoiceHash = sha256(render(input, totals, { withSignature: false })).toString('base64');
  const timestamp = `${input.issueDate}T${input.issueTime}`;
  const baseQr = {
    sellerName: input.seller.name,
    vatNumber: input.seller.vatNumber,
    timestamp,
    totalWithVat: totals.taxInclusive,
    vatTotal: totals.taxTotal,
  };

  let signature: string | null = null;
  let qr: string;
  let extensions: string | undefined;
  if (signing) {
    signature = signInvoiceHash(invoiceHash, signing.privateKey);
    qr = zatcaQr({
      ...baseQr,
      invoiceHash,
      signature,
      publicKey: signing.certificate.publicKey,
      certificateSignature:
        input.kind === ZatcaInvoiceKind.SIMPLIFIED ? signing.certificate.signature : undefined,
    });
    extensions = ublExtensions(invoiceHash, signature, signing.certificate, signing.signingTime || timestamp);
  } else {
    qr = zatcaQr(baseQr);
  }

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    render(input, totals, { extensions, qr, withSignature: !!signing });
  return { xml, invoiceHash, signature, qr, totals };
}

/** Extracts the QR value embedded in a (cleared) invoice XML. */
export function extractQrFromXml(xml: string): string | null {
  const m = xml.match(
    /<cbc:ID>QR<\/cbc:ID>\s*<cac:Attachment>\s*<cbc:EmbeddedDocumentBinaryObject[^>]*>([^<]+)<\/cbc:EmbeddedDocumentBinaryObject>/,
  );
  return m ? m[1].trim() : null;
}
