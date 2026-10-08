import { EtaAuthService } from './eta-auth.service';
import { EtaApiClient, EtaConnection } from './eta-api.client';
import { EtaApiError } from './eta-errors';

const tokenReq = {
  idSrvUrl: 'https://id.preprod.eta.gov.eg/',
  clientId: 'client-1',
  clientSecret: 'super-secret',
  scope: 'InvoicingAPI',
};

function tokenResponse(token: string, expiresIn = 3600) {
  return { status: 200, data: { access_token: token, expires_in: expiresIn, token_type: 'Bearer' }, text: '' };
}

describe('EtaAuthService (token caching)', () => {
  let http: { request: jest.Mock };
  let auth: EtaAuthService;
  let now: number;

  beforeEach(() => {
    http = { request: jest.fn() };
    auth = new EtaAuthService(http);
    now = 1_000_000;
    auth.now = () => now;
  });

  it('requests a client-credentials token from the identity server', async () => {
    http.request.mockResolvedValue(tokenResponse('tok-1'));
    await expect(auth.getToken(tokenReq)).resolves.toBe('tok-1');
    expect(http.request).toHaveBeenCalledWith({
      method: 'POST',
      url: 'https://id.preprod.eta.gov.eg/connect/token',
      headers: undefined,
      form: {
        grant_type: 'client_credentials',
        client_id: 'client-1',
        client_secret: 'super-secret',
        scope: 'InvoicingAPI',
      },
    });
  });

  it('reuses the cached token until shortly before it expires', async () => {
    http.request.mockResolvedValueOnce(tokenResponse('tok-1', 3600)).mockResolvedValueOnce(tokenResponse('tok-2'));
    await auth.getToken(tokenReq);
    now += 3600_000 - 61_000; // still inside (expiry - 60s skew)
    await expect(auth.getToken(tokenReq)).resolves.toBe('tok-1');
    expect(http.request).toHaveBeenCalledTimes(1);
    now += 2_000; // past the skewed expiry
    await expect(auth.getToken(tokenReq)).resolves.toBe('tok-2');
    expect(http.request).toHaveBeenCalledTimes(2);
  });

  it('de-duplicates concurrent token requests', async () => {
    let resolve!: (v: any) => void;
    http.request.mockReturnValue(new Promise((r) => (resolve = r)));
    const a = auth.getToken(tokenReq);
    const b = auth.getToken(tokenReq);
    resolve(tokenResponse('tok-1'));
    await expect(Promise.all([a, b])).resolves.toEqual(['tok-1', 'tok-1']);
    expect(http.request).toHaveBeenCalledTimes(1);
  });

  it('caches per client and POS device', async () => {
    http.request.mockResolvedValueOnce(tokenResponse('a')).mockResolvedValueOnce(tokenResponse('b'));
    await auth.getToken(tokenReq);
    await expect(
      auth.getToken({ ...tokenReq, scope: undefined, headers: { posserial: 'SN-1' } }),
    ).resolves.toBe('b');
  });

  it('throws without leaking the client secret', async () => {
    http.request.mockResolvedValue({ status: 400, data: { error: 'invalid_client' }, text: '' });
    const err = await auth.getToken(tokenReq).catch((e) => e);
    expect(err).toBeInstanceOf(EtaApiError);
    expect(err.message).not.toContain('super-secret');
    // failures are not cached
    http.request.mockResolvedValue(tokenResponse('tok-ok'));
    await expect(auth.getToken(tokenReq)).resolves.toBe('tok-ok');
  });

  it('refuses to call ETA without credentials', async () => {
    await expect(auth.getToken({ ...tokenReq, clientSecret: '' })).rejects.toBeInstanceOf(EtaApiError);
    expect(http.request).not.toHaveBeenCalled();
  });
});

describe('EtaApiClient', () => {
  const conn: EtaConnection = {
    apiBaseUrl: 'https://api.preprod.invoicing.eta.gov.eg',
    idSrvUrl: 'https://id.preprod.eta.gov.eg',
    portalUrl: 'https://preprod.invoicing.eta.gov.eg',
    clientId: 'c',
    clientSecret: 's',
  };
  let http: { request: jest.Mock };
  let auth: EtaAuthService;
  let client: EtaApiClient;

  beforeEach(() => {
    http = { request: jest.fn() };
    auth = new EtaAuthService(http);
    client = new EtaApiClient(http, auth);
  });

  it('submits documents with the bearer token', async () => {
    http.request
      .mockResolvedValueOnce(tokenResponse('tok'))
      .mockResolvedValueOnce({ status: 202, data: { submissionId: 'S1', acceptedDocuments: [], rejectedDocuments: [] }, text: '' });
    const res = await client.submitDocuments(conn, [{ internalID: 'INV-1' }]);
    expect(res.submissionId).toBe('S1');
    expect(http.request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: 'https://api.preprod.invoicing.eta.gov.eg/api/v1/documentsubmissions',
        json: { documents: [{ internalID: 'INV-1' }] },
        headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
      }),
    );
  });

  it('retries once with a fresh token on 401', async () => {
    http.request
      .mockResolvedValueOnce(tokenResponse('old'))
      .mockResolvedValueOnce({ status: 401, data: '', text: '' })
      .mockResolvedValueOnce(tokenResponse('new'))
      .mockResolvedValueOnce({ status: 200, data: { status: 'Valid' }, text: '' });
    await expect(client.getDocumentDetails(conn, 'U1')).resolves.toEqual({ status: 'Valid' });
    expect(http.request.mock.calls[3][0].headers.Authorization).toBe('Bearer new');
  });

  it('sends cancellations to the document state endpoint', async () => {
    http.request.mockResolvedValueOnce(tokenResponse('tok')).mockResolvedValueOnce({ status: 200, data: true, text: '' });
    await client.cancelDocument(conn, 'U1', 'wrong price');
    expect(http.request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        method: 'PUT',
        url: 'https://api.preprod.invoicing.eta.gov.eg/api/v1.0/documents/state/U1/state',
        json: { status: 'cancelled', reason: 'wrong price' },
      }),
    );
  });

  it('throws EtaApiError on other failures', async () => {
    http.request
      .mockResolvedValueOnce(tokenResponse('tok'))
      .mockResolvedValueOnce({ status: 400, data: { error: { code: 'BadStructure', message: 'bad' } }, text: '' });
    const err = await client.submitDocuments(conn, []).catch((e) => e);
    expect(err).toBeInstanceOf(EtaApiError);
    expect(err.isClientError).toBe(true);
    expect(err.message).toBe('ETA responded with HTTP 400: bad');
  });

  it('builds the public print URL', () => {
    expect(EtaApiClient.printUrl('https://invoicing.eta.gov.eg', 'U1', 'L1')).toBe(
      'https://invoicing.eta.gov.eg/print/documents/U1/share/L1',
    );
  });
});
