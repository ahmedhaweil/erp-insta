import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  COMPLIANCE_HTTP_CLIENT,
  ComplianceHttpClient,
} from '../http/compliance-http.client';
import { EtaApiError } from './eta-errors';

export interface EtaTokenRequest {
  idSrvUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  /** e-receipt POS headers (posserial, pososversion, posmodelframework, presharedkey). */
  headers?: Record<string, string>;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

/** Tokens are refreshed this long before their stated expiry. */
const EXPIRY_SKEW_MS = 60_000;

/**
 * OAuth2 client-credentials tokens from the ETA identity server
 * (POST {idSrv}/connect/token), cached in memory until shortly before expiry
 * and de-duplicated while a request is in flight.
 */
@Injectable()
export class EtaAuthService {
  private readonly logger = new Logger(EtaAuthService.name);
  private readonly cache = new Map<string, CachedToken>();
  private readonly inflight = new Map<string, Promise<string>>();

  constructor(@Inject(COMPLIANCE_HTTP_CLIENT) private readonly http: ComplianceHttpClient) {}

  /** Overridable clock (tests). */
  now(): number {
    return Date.now();
  }

  private key(req: EtaTokenRequest): string {
    return [req.idSrvUrl, req.clientId, req.scope || '', req.headers?.posserial || ''].join('|');
  }

  async getToken(req: EtaTokenRequest): Promise<string> {
    const key = this.key(req);
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.token;

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const promise = this.fetchToken(req, key).finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  invalidate(req: EtaTokenRequest): void {
    this.cache.delete(this.key(req));
  }

  private async fetchToken(req: EtaTokenRequest, key: string): Promise<string> {
    if (!req.clientId || !req.clientSecret) {
      throw new EtaApiError(401, { error: 'ETA client id / secret are not configured' });
    }
    const form: Record<string, string> = {
      grant_type: 'client_credentials',
      client_id: req.clientId,
      client_secret: req.clientSecret,
    };
    if (req.scope) form.scope = req.scope;

    const res = await this.http.request({
      method: 'POST',
      url: `${req.idSrvUrl.replace(/\/$/, '')}/connect/token`,
      headers: req.headers,
      form,
    });
    if (res.status < 200 || res.status >= 300 || !res.data?.access_token) {
      // Log the status and ETA's error code only, never the credentials.
      this.logger.warn(`ETA token request failed with HTTP ${res.status}`);
      throw new EtaApiError(res.status, res.data);
    }
    const ttlMs = Number(res.data.expires_in || 3600) * 1000;
    this.cache.set(key, {
      token: res.data.access_token,
      expiresAt: this.now() + Math.max(ttlMs - EXPIRY_SKEW_MS, 0),
    });
    return res.data.access_token;
  }
}
