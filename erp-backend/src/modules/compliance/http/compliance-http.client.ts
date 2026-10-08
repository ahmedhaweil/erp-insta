import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const COMPLIANCE_HTTP_CLIENT = Symbol('COMPLIANCE_HTTP_CLIENT');

export interface HttpRequest {
  method: 'GET' | 'POST' | 'PUT';
  url: string;
  headers?: Record<string, string>;
  /** JSON-serializable body (sent as application/json). */
  json?: unknown;
  /** URL-encoded form body. */
  form?: Record<string, string>;
  /** Raw text body (sent as text/plain unless a content-type header is given). */
  text?: string;
}

export interface HttpResponse<T = any> {
  status: number;
  data: T;
  text: string;
}

/**
 * Transport used by every tax-authority client. Production uses fetch();
 * unit tests inject a mock through the COMPLIANCE_HTTP_CLIENT token.
 * Implementations must never throw on non-2xx statuses: callers map them.
 */
export interface ComplianceHttpClient {
  request<T = any>(req: HttpRequest): Promise<HttpResponse<T>>;
}

export class ComplianceTransportError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
  }
}

@Injectable()
export class FetchComplianceHttpClient implements ComplianceHttpClient {
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    this.timeoutMs = Number(config.get('compliance.httpTimeoutMs')) || 30000;
  }

  async request<T = any>(req: HttpRequest): Promise<HttpResponse<T>> {
    const headers: Record<string, string> = { Accept: 'application/json', ...(req.headers || {}) };
    let body: string | undefined;
    if (req.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(req.json);
    } else if (req.form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(req.form).toString();
    } else if (req.text !== undefined) {
      headers['Content-Type'] = headers['Content-Type'] || 'text/plain';
      body = req.text;
    }

    let res: Response;
    try {
      res = await fetch(req.url, {
        method: req.method,
        headers,
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      // Never include the request (it may carry credentials) in the message.
      throw new ComplianceTransportError(
        `Request to ${new URL(req.url).host} failed: ${(err as Error).message}`,
        err,
      );
    }
    const text = await res.text();
    let data: any = text;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { status: res.status, data, text };
  }
}
