import { createHash, createPrivateKey, createSign, KeyObject, X509Certificate } from 'crypto';

/** Accepts a PEM certificate, its base64 body, or ZATCA's binarySecurityToken. */
export function normalizeCertificate(input: string): { pem: string; body: string } {
  let text = input.trim();
  if (!text.includes('BEGIN CERTIFICATE')) {
    // ZATCA returns binarySecurityToken = base64(base64 DER body).
    const decoded = Buffer.from(text.replace(/\s+/g, ''), 'base64').toString('utf8');
    if (/^MII[A-Za-z0-9+/=\s]+$/.test(decoded.trim())) text = decoded.trim();
  }
  const body = text
    .replace(/-----BEGIN CERTIFICATE-----/, '')
    .replace(/-----END CERTIFICATE-----/, '')
    .replace(/\s+/g, '');
  const pem = `-----BEGIN CERTIFICATE-----\n${body.match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`;
  return { pem, body };
}

/** Accepts a SEC1/PKCS#8 PEM or a bare base64 SEC1 body (as the ZATCA SDK emits). */
export function loadPrivateKey(input: string): KeyObject {
  const text = input.trim();
  if (text.includes('-----BEGIN')) return createPrivateKey(text);
  const body = text.replace(/\s+/g, '');
  return createPrivateKey(
    `-----BEGIN EC PRIVATE KEY-----\n${body.match(/.{1,64}/g)!.join('\n')}\n-----END EC PRIVATE KEY-----\n`,
  );
}

export interface CertificateInfo {
  body: string;
  /** SubjectPublicKeyInfo DER (QR tag 8). */
  publicKey: Buffer;
  /** signatureValue of the certificate (QR tag 9). */
  signature: Buffer;
  /** RFC 2253 style issuer, most specific first (e.g. "CN=..., DC=gov"). */
  issuerName: string;
  /** Decimal serial number. */
  serialNumber: string;
}

export function parseCertificate(input: string): CertificateInfo {
  const { pem, body } = normalizeCertificate(input);
  const x509 = new X509Certificate(pem);
  const publicKey = x509.publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  const issuerName = x509.issuer
    .split('\n')
    .filter(Boolean)
    .reverse()
    .join(', ');
  return {
    body,
    publicKey,
    signature: certificateSignature(x509.raw),
    issuerName,
    serialNumber: BigInt(`0x${x509.serialNumber}`).toString(10),
  };
}

/** Reads Certificate.signatureValue (3rd element of the outer SEQUENCE). */
export function certificateSignature(der: Buffer): Buffer {
  const outer = readTlv(der, 0);
  if (outer.tag !== 0x30) throw new Error('Certificate is not a DER SEQUENCE');
  let offset = outer.contentStart;
  readTlv(der, offset); // tbsCertificate
  offset = readTlv(der, offset).end;
  offset = readTlv(der, offset).end; // signatureAlgorithm
  const sig = readTlv(der, offset);
  if (sig.tag !== 0x03) throw new Error('Certificate signatureValue is not a BIT STRING');
  // First content byte = number of unused bits.
  return der.subarray(sig.contentStart + 1, sig.end);
}

function readTlv(buf: Buffer, offset: number) {
  const tag = buf[offset];
  let len = buf[offset + 1];
  let headerLen = 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[offset + 2 + i];
    headerLen += n;
  }
  const contentStart = offset + headerLen;
  return { tag, contentStart, end: contentStart + len };
}

export function sha256(data: string | Buffer): Buffer {
  return createHash('sha256').update(data).digest();
}

/** base64 of the hex digest (ZATCA's format for PIH seed, cert and signed-properties digests). */
export function sha256HexBase64(data: string | Buffer): string {
  return Buffer.from(createHash('sha256').update(data).digest('hex'), 'utf8').toString('base64');
}

/** Initial PIH: base64(hex(sha256("0"))). */
export const ZATCA_INITIAL_PIH = sha256HexBase64('0');

/**
 * ECDSA (secp256k1) signature of the invoice hash, base64 DER. As in the
 * ZATCA SDK, the signed message is the binary invoice hash (it is hashed
 * again with SHA-256 by the ECDSA-SHA256 scheme).
 */
export function signInvoiceHash(invoiceHashBase64: string, privateKey: KeyObject): string {
  const signer = createSign('sha256');
  signer.update(Buffer.from(invoiceHashBase64, 'base64'));
  return signer.sign(privateKey).toString('base64');
}
