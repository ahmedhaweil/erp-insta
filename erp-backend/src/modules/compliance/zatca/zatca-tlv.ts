/**
 * ZATCA QR code: Tag-Length-Value records, base64 encoded.
 *  1 seller name  2 VAT number  3 timestamp  4 total with VAT  5 VAT total
 *  (phase 2, simplified invoices)
 *  6 invoice hash (base64 text)  7 ECDSA signature (base64 text)
 *  8 ECDSA public key (DER SubjectPublicKeyInfo bytes)
 *  9 certificate signature (raw bytes, simplified invoices only)
 * Tag and length are one byte each; values are UTF-8 text or raw bytes.
 */
export interface TlvField {
  tag: number;
  value: string | Buffer;
}

export function encodeTlv(fields: TlvField[]): Buffer {
  const parts: Buffer[] = [];
  for (const { tag, value } of fields) {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
    if (tag < 1 || tag > 255) throw new Error(`Invalid TLV tag ${tag}`);
    if (bytes.length > 255) throw new Error(`TLV value for tag ${tag} exceeds 255 bytes`);
    parts.push(Buffer.from([tag, bytes.length]), bytes);
  }
  return Buffer.concat(parts);
}

export function decodeTlv(input: string | Buffer): { tag: number; value: Buffer }[] {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, 'base64');
  const out: { tag: number; value: Buffer }[] = [];
  let i = 0;
  while (i < buf.length) {
    const tag = buf[i];
    const len = buf[i + 1];
    if (len === undefined || i + 2 + len > buf.length) throw new Error('Malformed TLV data');
    out.push({ tag, value: buf.subarray(i + 2, i + 2 + len) });
    i += 2 + len;
  }
  return out;
}

export interface ZatcaQrInput {
  sellerName: string;
  vatNumber: string;
  /** e.g. 2022-04-25T15:30:00Z (phase 1) or 2022-09-07T12:21:28 (phase 2). */
  timestamp: string;
  totalWithVat: string | number;
  vatTotal: string | number;
  /** Phase 2 */
  invoiceHash?: string;
  signature?: string;
  publicKey?: Buffer;
  certificateSignature?: Buffer;
}

const money = (v: string | number) => (typeof v === 'number' ? v.toFixed(2) : v);

export function zatcaQr(input: ZatcaQrInput): string {
  const fields: TlvField[] = [
    { tag: 1, value: input.sellerName },
    { tag: 2, value: input.vatNumber },
    { tag: 3, value: input.timestamp },
    { tag: 4, value: money(input.totalWithVat) },
    { tag: 5, value: money(input.vatTotal) },
  ];
  if (input.invoiceHash) fields.push({ tag: 6, value: input.invoiceHash });
  if (input.signature) fields.push({ tag: 7, value: input.signature });
  if (input.publicKey) fields.push({ tag: 8, value: input.publicKey });
  if (input.certificateSignature) fields.push({ tag: 9, value: input.certificateSignature });
  return encodeTlv(fields).toString('base64');
}
