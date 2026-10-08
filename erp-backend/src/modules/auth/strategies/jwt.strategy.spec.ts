import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  const strategy = new JwtStrategy({ get: () => 'secret' } as unknown as ConfigService);
  const base = { sub: 'u1', tenantId: 't1', email: 'a@b.c', roles: [], branchIds: [], iat: 0, exp: 0 };

  it('accepts a regular access token payload', async () => {
    await expect(strategy.validate(base)).resolves.toEqual(base);
  });

  it('refuses the intermediate 2FA token so a password alone cannot access the API', async () => {
    await expect(strategy.validate({ ...base, requires2fa: true })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('refuses payloads without subject or tenant', async () => {
    await expect(strategy.validate({ ...base, tenantId: '' })).rejects.toThrow(UnauthorizedException);
  });
});
