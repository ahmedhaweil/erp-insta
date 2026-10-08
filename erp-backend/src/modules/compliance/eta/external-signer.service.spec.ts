import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { ExternalSignerService } from './external-signer.service';

describe('ExternalSignerService', () => {
  const config = (values: Record<string, string | undefined>) => ({ get: (k: string) => values[k] }) as any;

  it('posts the serialized document to the signer and returns the signature', async () => {
    const http = { request: jest.fn().mockResolvedValue({ status: 200, data: { signature: 'MIIG...' }, text: '' }) };
    const signer = new ExternalSignerService(http, config({ 'eta.signerUrl': 'http://localhost:18088/sign', 'eta.signerToken': 't' }));
    await expect(signer.sign('"ISSUER"...')).resolves.toBe('MIIG...');
    expect(http.request).toHaveBeenCalledWith({
      method: 'POST',
      url: 'http://localhost:18088/sign',
      headers: { Authorization: 'Bearer t' },
      json: { data: '"ISSUER"...', algorithm: 'CAdES-BES' },
    });
  });

  it('prefers the tenant signer URL and accepts a plain-text answer', async () => {
    const http = { request: jest.fn().mockResolvedValue({ status: 200, data: '"MIIabc"\n', text: '' }) };
    const signer = new ExternalSignerService(http, config({ 'eta.signerUrl': 'http://global' }));
    await expect(signer.sign('x', 'http://tenant')).resolves.toBe('MIIabc');
    expect(http.request.mock.calls[0][0].url).toBe('http://tenant');
  });

  it('fails clearly when no signer is configured or it errors', async () => {
    const http = { request: jest.fn().mockResolvedValue({ status: 500, data: {}, text: '' }) };
    await expect(new ExternalSignerService(http, config({})).sign('x')).rejects.toBeInstanceOf(BadRequestException);
    await expect(new ExternalSignerService(http, config({ 'eta.signerUrl': 'http://s' })).sign('x')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });
});
