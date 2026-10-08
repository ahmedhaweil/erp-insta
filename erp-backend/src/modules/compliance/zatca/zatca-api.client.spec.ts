import { EInvoiceStatus } from '../entities/e-invoice.entity';
import { mapZatcaResponse, ZatcaApiClient } from './zatca-api.client';

describe('ZatcaApiClient', () => {
  const conn = { baseUrl: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal/', binarySecurityToken: 'TOKEN', secret: 'SECRET' };

  it('reports simplified invoices with basic auth and base64 XML', async () => {
    const http = {
      request: jest.fn().mockResolvedValue({
        status: 200,
        data: { validationResults: { status: 'PASS', warningMessages: [], errorMessages: [] }, reportingStatus: 'REPORTED' },
        text: '',
      }),
    };
    const res = await new ZatcaApiClient(http).report(conn, { invoiceHash: 'H', uuid: 'U', xml: '<Invoice/>' });
    expect(res.status).toBe(EInvoiceStatus.REPORTED);
    expect(http.request).toHaveBeenCalledWith({
      method: 'POST',
      url: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal/invoices/reporting/single',
      headers: {
        'Accept-Version': 'V2',
        'Accept-Language': 'en',
        Authorization: `Basic ${Buffer.from('TOKEN:SECRET').toString('base64')}`,
        'Clearance-Status': '0',
      },
      json: { invoiceHash: 'H', uuid: 'U', invoice: Buffer.from('<Invoice/>').toString('base64') },
    });
  });

  it('clears standard invoices and returns the stamped XML', async () => {
    const http = {
      request: jest.fn().mockResolvedValue({
        status: 200,
        data: { clearanceStatus: 'CLEARED', clearedInvoice: Buffer.from('<Invoice>c</Invoice>').toString('base64') },
        text: '',
      }),
    };
    const res = await new ZatcaApiClient(http).clear(conn, { invoiceHash: 'H', uuid: 'U', xml: 'x' });
    expect(res.status).toBe(EInvoiceStatus.CLEARED);
    expect(res.clearedXml).toBe('<Invoice>c</Invoice>');
    expect(http.request.mock.calls[0][0].headers['Clearance-Status']).toBe('1');
    expect(http.request.mock.calls[0][0].url).toMatch(/\/invoices\/clearance\/single$/);
  });
});

describe('mapZatcaResponse', () => {
  it('keeps warnings on 202 (accepted with warnings)', () => {
    const r = mapZatcaResponse(
      202,
      {
        reportingStatus: 'REPORTED',
        validationResults: { status: 'WARNING', warningMessages: [{ code: 'BR-KSA-08', message: 'w', category: 'KSA' }], errorMessages: [] },
      },
      'reporting',
    );
    expect(r.status).toBe(EInvoiceStatus.REPORTED);
    expect(r.warnings).toEqual([{ code: 'BR-KSA-08', message: 'w', category: 'KSA', severity: 'warning' }]);
  });

  it('maps 400 to invalid with the error messages', () => {
    const r = mapZatcaResponse(
      400,
      { reportingStatus: 'NOT_REPORTED', validationResults: { status: 'ERROR', errorMessages: [{ code: 'invoiceHash', message: 'bad hash' }] } },
      'reporting',
    );
    expect(r.status).toBe(EInvoiceStatus.INVALID);
    expect(r.errors[0]).toMatchObject({ code: 'invoiceHash', message: 'bad hash', severity: 'error' });
  });

  it('maps NOT_CLEARED to invalid, 409 to already accepted, 401/5xx to failed', () => {
    expect(mapZatcaResponse(200, { clearanceStatus: 'NOT_CLEARED' }, 'clearance').status).toBe(EInvoiceStatus.INVALID);
    expect(mapZatcaResponse(409, {}, 'clearance').status).toBe(EInvoiceStatus.CLEARED);
    expect(mapZatcaResponse(409, {}, 'reporting').status).toBe(EInvoiceStatus.REPORTED);
    expect(mapZatcaResponse(401, {}, 'reporting').status).toBe(EInvoiceStatus.FAILED);
    expect(mapZatcaResponse(503, { message: 'down' }, 'reporting').errors[0].message).toBe('ZATCA responded with HTTP 503: down');
  });
});
