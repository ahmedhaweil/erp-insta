import { BadGatewayException, BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  COMPLIANCE_HTTP_CLIENT,
  ComplianceHttpClient,
} from '../http/compliance-http.client';

/**
 * Signs ETA documents through an external signing middleware (the service
 * that talks to the taxpayer's USB e-signature token / HSM).
 *
 * Contract: POST {signerUrl} with JSON
 *     { "data": "<ETA canonical serialization>", "algorithm": "CAdES-BES" }
 *   and optional `Authorization: Bearer <ETA_SIGNER_TOKEN>`.
 * The signer answers with the base64 CAdES-BES (detached, SHA-256) signature,
 * either as the plain-text body or as JSON { signature | value | cades }.
 * The result is placed in `signatures[{ signatureType: 'I', value }]`.
 */
@Injectable()
export class ExternalSignerService {
  private readonly logger = new Logger(ExternalSignerService.name);

  constructor(
    @Inject(COMPLIANCE_HTTP_CLIENT) private readonly http: ComplianceHttpClient,
    private readonly config: ConfigService,
  ) {}

  resolveUrl(tenantSignerUrl?: string | null): string | null {
    return tenantSignerUrl || this.config.get<string>('eta.signerUrl') || null;
  }

  async sign(serialized: string, tenantSignerUrl?: string | null): Promise<string> {
    const url = this.resolveUrl(tenantSignerUrl);
    if (!url) {
      throw new BadRequestException(
        'No ETA signer configured: set ETA_SIGNER_URL or the tenant signer URL (or use document version 0.9 on preprod)',
      );
    }
    const token = this.config.get<string>('eta.signerToken');
    const res = await this.http.request({
      method: 'POST',
      url,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      json: { data: serialized, algorithm: 'CAdES-BES' },
    });
    if (res.status < 200 || res.status >= 300) {
      this.logger.warn(`ETA signer returned HTTP ${res.status}`);
      throw new BadGatewayException(`ETA signer returned HTTP ${res.status}`);
    }
    const signature = ExternalSignerService.extractSignature(res.data);
    if (!signature) throw new BadGatewayException('ETA signer returned no signature');
    return signature;
  }

  static extractSignature(data: unknown): string | null {
    if (typeof data === 'string') return data.trim().replace(/^"|"$/g, '') || null;
    if (data && typeof data === 'object') {
      const d = data as Record<string, any>;
      const value = d.signature ?? d.value ?? d.cades ?? d.data?.signature;
      return typeof value === 'string' && value.trim() ? value.trim() : null;
    }
    return null;
  }
}
