import { Inject, Injectable } from '@nestjs/common';
import {
  COMPLIANCE_HTTP_CLIENT,
  ComplianceHttpClient,
} from '../http/compliance-http.client';
import { ComplianceMessage, EInvoiceStatus } from '../entities/e-invoice.entity';
import { ZatcaEnvironment } from '../entities/compliance-settings.entity';

export const ZATCA_URLS: Record<ZatcaEnvironment, string> = {
  [ZatcaEnvironment.SANDBOX]: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal',
  [ZatcaEnvironment.SIMULATION]: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation',
  [ZatcaEnvironment.PRODUCTION]: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/core',
};

export interface ZatcaConnection {
  baseUrl: string;
  /** binarySecurityToken (base64 of the certificate body) from the CSID call. */
  binarySecurityToken: string;
  secret: string;
}

export interface ZatcaSubmitRequest {
  invoiceHash: string;
  uuid: string;
  /** Signed invoice XML (sent base64 encoded). */
  xml: string;
}

export interface ZatcaSubmitResult {
  httpStatus: number;
  status: EInvoiceStatus;
  errors: ComplianceMessage[];
  warnings: ComplianceMessage[];
  /** Standard invoices: the XML stamped by ZATCA (decoded). */
  clearedXml?: string;
  data: any;
}

/**
 * Fatoora reporting (simplified, within 24h) and clearance (standard,
 * before sharing with the buyer) APIs.
 */
@Injectable()
export class ZatcaApiClient {
  constructor(@Inject(COMPLIANCE_HTTP_CLIENT) private readonly http: ComplianceHttpClient) {}

  report(conn: ZatcaConnection, req: ZatcaSubmitRequest): Promise<ZatcaSubmitResult> {
    return this.submit(conn, '/invoices/reporting/single', req, '0', 'reporting');
  }

  clear(conn: ZatcaConnection, req: ZatcaSubmitRequest): Promise<ZatcaSubmitResult> {
    return this.submit(conn, '/invoices/clearance/single', req, '1', 'clearance');
  }

  /** Onboarding compliance check of a sample invoice with the compliance CSID. */
  complianceCheck(conn: ZatcaConnection, req: ZatcaSubmitRequest): Promise<ZatcaSubmitResult> {
    return this.submit(conn, '/compliance/invoices', req, undefined, 'compliance');
  }

  private async submit(
    conn: ZatcaConnection,
    path: string,
    req: ZatcaSubmitRequest,
    clearanceStatus: string | undefined,
    mode: 'reporting' | 'clearance' | 'compliance',
  ): Promise<ZatcaSubmitResult> {
    const auth = Buffer.from(`${conn.binarySecurityToken}:${conn.secret}`, 'utf8').toString('base64');
    const headers: Record<string, string> = {
      'Accept-Version': 'V2',
      'Accept-Language': 'en',
      Authorization: `Basic ${auth}`,
    };
    if (clearanceStatus !== undefined) headers['Clearance-Status'] = clearanceStatus;
    const res = await this.http.request({
      method: 'POST',
      url: `${conn.baseUrl.replace(/\/$/, '')}${path}`,
      headers,
      json: {
        invoiceHash: req.invoiceHash,
        uuid: req.uuid,
        invoice: Buffer.from(req.xml, 'utf8').toString('base64'),
      },
    });
    return mapZatcaResponse(res.status, res.data, mode);
  }
}

function messages(list: any[] | undefined, severity: ComplianceMessage['severity']): ComplianceMessage[] {
  return (list || []).map((m) => ({
    code: m.code,
    message: m.message,
    category: m.category,
    severity,
  }));
}

/**
 * Maps a Fatoora response: 200 = accepted, 202 = accepted with warnings,
 * 400 = rejected (validation errors), 401/403/429/5xx = transport failure
 * (retry unchanged), 409 = already reported/cleared.
 */
export function mapZatcaResponse(
  httpStatus: number,
  data: any,
  mode: 'reporting' | 'clearance' | 'compliance',
): ZatcaSubmitResult {
  const vr = data?.validationResults || {};
  const errors = messages(vr.errorMessages, 'error');
  const warnings = messages(vr.warningMessages, 'warning');
  const result: ZatcaSubmitResult = { httpStatus, status: EInvoiceStatus.FAILED, errors, warnings, data };

  if (httpStatus === 200 || httpStatus === 202) {
    if (mode === 'clearance') {
      const cleared = String(data?.clearanceStatus || '').toUpperCase() === 'CLEARED';
      result.status = cleared ? EInvoiceStatus.CLEARED : EInvoiceStatus.INVALID;
      if (data?.clearedInvoice) {
        result.clearedXml = Buffer.from(data.clearedInvoice, 'base64').toString('utf8');
      }
    } else if (mode === 'reporting') {
      const reported = String(data?.reportingStatus || '').toUpperCase() === 'REPORTED';
      result.status = reported ? EInvoiceStatus.REPORTED : EInvoiceStatus.INVALID;
    } else {
      result.status = (vr.status || '').toUpperCase() === 'ERROR' ? EInvoiceStatus.INVALID : EInvoiceStatus.VALID;
    }
  } else if (httpStatus === 400) {
    result.status = EInvoiceStatus.INVALID;
    if (!errors.length) {
      result.errors = [{ message: data?.message || 'Rejected by ZATCA', code: data?.code, severity: 'error' }];
    }
  } else if (httpStatus === 409) {
    // Duplicate submission of an invoice ZATCA already holds.
    result.status = mode === 'clearance' ? EInvoiceStatus.CLEARED : EInvoiceStatus.REPORTED;
  } else {
    result.errors = [
      { message: `ZATCA responded with HTTP ${httpStatus}${data?.message ? `: ${data.message}` : ''}`, severity: 'error' },
    ];
  }
  return result;
}
