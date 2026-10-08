import { Inject, Injectable } from '@nestjs/common';
import {
  COMPLIANCE_HTTP_CLIENT,
  ComplianceHttpClient,
  HttpRequest,
  HttpResponse,
} from '../http/compliance-http.client';
import { EtaAuthService, EtaTokenRequest } from './eta-auth.service';
import { EtaApiError } from './eta-errors';

export const ETA_URLS = {
  preprod: {
    api: 'https://api.preprod.invoicing.eta.gov.eg',
    idSrv: 'https://id.preprod.eta.gov.eg',
    portal: 'https://preprod.invoicing.eta.gov.eg',
  },
  prod: {
    api: 'https://api.invoicing.eta.gov.eg',
    idSrv: 'https://id.eta.gov.eg',
    portal: 'https://invoicing.eta.gov.eg',
  },
} as const;

export interface EtaConnection {
  apiBaseUrl: string;
  idSrvUrl: string;
  portalUrl: string;
  clientId: string;
  clientSecret: string;
  /** e-receipt POS identification headers (sent with the token request). */
  posHeaders?: Record<string, string>;
}

export interface EtaSubmissionResponse {
  submissionId: string;
  acceptedDocuments: { uuid: string; longId?: string; internalId?: string; hashKey?: string; receiptNumber?: string }[];
  rejectedDocuments: { internalId?: string; receiptNumber?: string; uuid?: string; error: any }[];
}

/**
 * Thin client over the ETA e-invoicing and e-receipt REST APIs. Handles the
 * bearer token (retrying once with a fresh token on 401) and turns non-2xx
 * answers into EtaApiError. All network I/O goes through the injectable
 * ComplianceHttpClient.
 */
@Injectable()
export class EtaApiClient {
  constructor(
    @Inject(COMPLIANCE_HTTP_CLIENT) private readonly http: ComplianceHttpClient,
    private readonly auth: EtaAuthService,
  ) {}

  /** Public share/print URL of a document (also used as its QR content). */
  static printUrl(portalUrl: string, uuid: string, longId: string): string {
    return `${portalUrl.replace(/\/$/, '')}/print/documents/${uuid}/share/${longId}`;
  }

  submitDocuments(conn: EtaConnection, documents: Record<string, any>[]): Promise<EtaSubmissionResponse> {
    return this.call(conn, { method: 'POST', url: '/api/v1/documentsubmissions', json: { documents } });
  }

  getSubmission(conn: EtaConnection, submissionUuid: string, pageSize = 100): Promise<any> {
    return this.call(conn, {
      method: 'GET',
      url: `/api/v1/documentsubmissions/${encodeURIComponent(submissionUuid)}?PageNo=1&PageSize=${pageSize}`,
    });
  }

  getDocumentDetails(conn: EtaConnection, uuid: string): Promise<any> {
    return this.call(conn, { method: 'GET', url: `/api/v1/documents/${encodeURIComponent(uuid)}/details` });
  }

  getDocumentRaw(conn: EtaConnection, uuid: string): Promise<any> {
    return this.call(conn, { method: 'GET', url: `/api/v1/documents/${encodeURIComponent(uuid)}/raw` });
  }

  /** Issuer cancellation of a valid document (allowed within ETA's window). */
  cancelDocument(conn: EtaConnection, uuid: string, reason: string): Promise<any> {
    return this.call(conn, {
      method: 'PUT',
      url: `/api/v1.0/documents/state/${encodeURIComponent(uuid)}/state`,
      json: { status: 'cancelled', reason },
    });
  }

  /** Receiver rejection of a document issued to this taxpayer. */
  rejectDocument(conn: EtaConnection, uuid: string, reason: string): Promise<any> {
    return this.call(conn, {
      method: 'PUT',
      url: `/api/v1.0/documents/state/${encodeURIComponent(uuid)}/state`,
      json: { status: 'rejected', reason },
    });
  }

  submitReceipts(conn: EtaConnection, receipts: Record<string, any>[]): Promise<EtaSubmissionResponse> {
    return this.call(conn, { method: 'POST', url: '/api/v1/receiptsubmissions', json: { receipts } });
  }

  getReceiptSubmission(conn: EtaConnection, submissionUuid: string): Promise<any> {
    return this.call(conn, {
      method: 'GET',
      url: `/api/v1/receiptsubmissions/${encodeURIComponent(submissionUuid)}/details?PageNo=1&PageSize=100`,
    });
  }

  private tokenRequest(conn: EtaConnection): EtaTokenRequest {
    return {
      idSrvUrl: conn.idSrvUrl,
      clientId: conn.clientId,
      clientSecret: conn.clientSecret,
      scope: conn.posHeaders ? undefined : 'InvoicingAPI',
      headers: conn.posHeaders,
    };
  }

  private async call<T = any>(conn: EtaConnection, req: HttpRequest, retried = false): Promise<T> {
    const tokenReq = this.tokenRequest(conn);
    const token = await this.auth.getToken(tokenReq);
    const res: HttpResponse<T> = await this.http.request<T>({
      ...req,
      url: `${conn.apiBaseUrl.replace(/\/$/, '')}${req.url}`,
      headers: { ...(req.headers || {}), Authorization: `Bearer ${token}`, 'Accept-Language': 'en' },
    });
    if (res.status === 401 && !retried) {
      this.auth.invalidate(tokenReq);
      return this.call<T>(conn, req, true);
    }
    if (res.status < 200 || res.status >= 300) throw new EtaApiError(res.status, res.data);
    return res.data;
  }
}
