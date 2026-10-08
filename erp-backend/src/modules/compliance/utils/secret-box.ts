import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const PREFIX = 'enc:v1:';

/**
 * Optional at-rest encryption of compliance secrets (AES-256-GCM). The key is
 * derived from COMPLIANCE_SECRET_KEY; when it is empty values are stored as
 * given. Encrypted values are recognised by their prefix, so enabling the key
 * later keeps older plaintext values readable.
 */
export class SecretBox {
  private readonly key: Buffer | null;

  constructor(secret?: string | null) {
    this.key = secret ? createHash('sha256').update(secret).digest() : null;
  }

  seal(value: string | null | undefined): string | null {
    if (value === null || value === undefined || value === '') return value ?? null;
    if (!this.key || value.startsWith(PREFIX)) return value;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return PREFIX + Buffer.concat([iv, tag, data]).toString('base64');
  }

  open(value: string | null | undefined): string | null {
    if (!value) return value ?? null;
    if (!value.startsWith(PREFIX)) return value;
    if (!this.key) throw new Error('COMPLIANCE_SECRET_KEY is required to read encrypted compliance secrets');
    const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  }
}

/** Shows only whether a secret is set (never its value). */
export function maskSecret(value: string | null | undefined): string | null {
  return value ? '********' : null;
}
